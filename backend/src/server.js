import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import http from 'node:http'
import morgan from 'morgan'

import { createToken, hashPassword, requireAuth, requireOrganizer, serializeUser, verifyPassword } from './auth.js'
import { config } from './config.js'
import { db, migrate, nowIso } from './db.js'
import {
  createLaunch,
  createQuiz,
  getHistory,
  getLaunchAnalytics,
  getLaunchByRoom,
  getLaunchExportCsv,
  getLaunchState,
  getMyQuizzes,
  getQuizDetails,
  joinLaunch,
  replaceQuestions,
  serializeLaunch,
  updateQuiz,
} from './quizService.js'
import { setupRealtime } from './realtime.js'

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function sessionPayload(user) {
  return {
    access_token: createToken(user),
    token_type: 'bearer',
    user: serializeUser(user),
  }
}

migrate()

const app = express()
const server = http.createServer(app)
setupRealtime(server)

app.use(helmet({ contentSecurityPolicy: false }))
app.use(express.json({ limit: '2mb' }))
app.use(morgan('dev'))
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true)
    return callback(null, false)
  },
  credentials: true,
}))

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: config.appName, database: 'sqlite' })
})

app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const fullName = String(req.body.full_name || '').trim()
  const email = normalizeEmail(req.body.email)
  const password = String(req.body.password || '')
  const role = req.body.role === 'organizer' ? 'organizer' : 'participant'

  if (fullName.length < 2) return res.status(400).json({ detail: 'Укажите ФИО или никнейм' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ detail: 'Укажите корректный email' })
  if (password.length < 6) return res.status(400).json({ detail: 'Пароль должен быть не короче 6 символов' })

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existing) return res.status(409).json({ detail: 'Пользователь с таким email уже зарегистрирован' })

  const info = db.prepare(`
    INSERT INTO users (full_name, email, password_hash, role, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(fullName, email, hashPassword(password), role, nowIso())

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
  return res.status(201).json(sessionPayload(user))
}))

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email)
  const password = String(req.body.password || '')
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ detail: 'Неверный email или пароль' })
  }
  return res.json(sessionPayload(user))
}))

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(serializeUser(req.user))
})

app.get('/api/quizzes/my', requireAuth, (req, res) => {
  if (req.user.role !== 'organizer') return res.json([])
  res.json(getMyQuizzes(req.user.id))
})

app.post('/api/quizzes', requireAuth, requireOrganizer, asyncHandler(async (req, res) => {
  const quiz = createQuiz(req.user.id, req.body)
  res.status(201).json(quiz)
}))

app.get('/api/quizzes/:quizId', requireAuth, (req, res) => {
  const quiz = getQuizDetails(Number(req.params.quizId))
  if (!quiz) return res.status(404).json({ detail: 'Квиз не найден' })
  const row = db.prepare('SELECT owner_id FROM quizzes WHERE id = ?').get(quiz.id)
  if (req.user.role !== 'organizer' || row?.owner_id !== req.user.id) {
    return res.status(403).json({ detail: 'Детали квиза доступны только его организатору' })
  }
  return res.json(quiz)
})

app.put('/api/quizzes/:quizId', requireAuth, requireOrganizer, asyncHandler(async (req, res) => {
  const result = updateQuiz(req.user.id, Number(req.params.quizId), req.body)
  if (result.status >= 400) return res.status(result.status).json({ detail: result.detail })
  return res.json(result.data)
}))

app.post('/api/quizzes/:quizId/questions', requireAuth, requireOrganizer, asyncHandler(async (req, res) => {
  const result = replaceQuestions(req.user.id, Number(req.params.quizId), req.body)
  if (result.status >= 400) return res.status(result.status).json({ detail: result.detail })
  return res.json(result.data)
}))

app.post('/api/sessions', requireAuth, requireOrganizer, (req, res) => {
  const result = createLaunch(req.user.id, Number(req.body.quiz_id))
  if (result.status >= 400) return res.status(result.status).json({ detail: result.detail })
  return res.status(result.status).json(result.data)
})

app.post('/api/sessions/:roomCode/join', requireAuth, (req, res) => {
  const result = joinLaunch(req.user, req.params.roomCode, req.body.display_name)
  if (result.status >= 400) return res.status(result.status).json({ detail: result.detail })
  return res.json(result.data)
})

app.get('/api/sessions/:roomCode', requireAuth, (req, res) => {
  const launch = getLaunchByRoom(req.params.roomCode)
  if (!launch) return res.status(404).json({ detail: 'Комната не найдена' })
  if (req.user.role === 'organizer' && launch.organizer_id !== req.user.id) {
    return res.status(403).json({ detail: 'Нет доступа' })
  }
  if (req.user.role === 'participant') {
    const participant = db
      .prepare('SELECT id FROM launch_participants WHERE launch_id = ? AND user_id = ?')
      .get(launch.id, req.user.id)
    if (!participant) return res.status(403).json({ detail: 'Сначала присоединитесь к комнате' })
  }
  const state = getLaunchState(req.params.roomCode)
  return res.json(state)
})

app.get('/api/sessions/:roomCode/analytics', requireAuth, requireOrganizer, (req, res) => {
  const launch = getLaunchByRoom(req.params.roomCode)
  if (!launch) return res.status(404).json({ detail: 'Комната не найдена' })
  if (launch.organizer_id !== req.user.id) {
    return res.status(403).json({ detail: 'Административная аналитика доступна только организатору квиза' })
  }
  return res.json(getLaunchAnalytics(req.params.roomCode))
})

app.get('/api/sessions/:roomCode/export.csv', requireAuth, requireOrganizer, (req, res) => {
  const launch = getLaunchByRoom(req.params.roomCode)
  if (!launch) return res.status(404).json({ detail: 'Комната не найдена' })
  if (launch.organizer_id !== req.user.id) {
    return res.status(403).json({ detail: 'Экспорт результатов доступен только организатору квиза' })
  }

  const csv = getLaunchExportCsv(req.params.roomCode)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="quizhub-${launch.room_code}-results.csv"`)
  return res.send(csv)
})

app.get('/api/history', requireAuth, (req, res) => {
  res.json({ items: getHistory(req.user) })
})

app.get('/api/sessions/:roomCode/raw', requireAuth, requireOrganizer, (req, res) => {
  const launch = getLaunchByRoom(req.params.roomCode)
  if (!launch) return res.status(404).json({ detail: 'Комната не найдена' })
  if (launch.organizer_id !== req.user.id) return res.status(403).json({ detail: 'Нет доступа' })
  return res.json(serializeLaunch(launch))
})

app.use((err, req, res, next) => {
  const detail = err.message || 'Ошибка сервера'
  if (process.env.NODE_ENV !== 'test') console.error(err)
  return res.status(400).json({ detail })
})

server.listen(config.port, '0.0.0.0', () => {
  console.log(`${config.appName} backend listening on port ${config.port}`)
  console.log(`SQLite database: ${config.databaseFile}`)
})
