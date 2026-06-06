import { Server } from 'socket.io'

import { getUserFromToken } from './auth.js'
import { config } from './config.js'
import { db, nowIso } from './db.js'
import {
  getAnswerProgress,
  buildQuestionAnalytics,
  closeCurrentQuestion,
  getLaunchAnalytics,
  getLaunchByRoom,
  getQuestionOrder,
  getLaunchSettings,
  getLaunchState,
  getLeaderboard,
  getParticipantForUser,
  getParticipants,
  getPublicQuestion,
  joinLaunch,
  startQuestion,
  submitAnswer,
} from './quizService.js'

const timers = new Map()
const countdownTimers = new Map()

function socketCorsOrigin(origin, callback) {
  if (!origin || config.corsOrigins.includes(origin)) return callback(null, true)
  return callback(null, false)
}

function emitToRoom(io, roomCode, payload) {
  io.to(roomCode).emit('message', payload)
}

async function emitToRole(io, roomCode, role, payload) {
  const sockets = await io.in(roomCode).fetchSockets()
  sockets
    .filter((socket) => socket.data.user?.role === role)
    .forEach((socket) => socket.emit('message', payload))
}

function clearTimer(roomCode) {
  const timer = timers.get(roomCode)
  if (timer) clearTimeout(timer)
  timers.delete(roomCode)
}

function clearCountdown(roomCode) {
  const countdown = countdownTimers.get(roomCode)
  if (countdown?.timer) clearTimeout(countdown.timer)
  countdownTimers.delete(roomCode)
}

function scheduleAutoClose(io, roomCode, expiresAtMs) {
  clearTimer(roomCode)
  const delay = Math.max(0, expiresAtMs - Date.now())
  timers.set(roomCode, setTimeout(async () => {
    const launch = getLaunchByRoom(roomCode)
    if (!launch || launch.status !== 'active' || !launch.active_question_id) return
    await closeQuestionAndBroadcast(io, launch)
  }, delay))
}

function emitLobbyState(io, roomCode) {
  const launch = getLaunchByRoom(roomCode)
  if (!launch) return
  emitToRoom(io, roomCode, {
    type: 'lobby_state',
    room_code: roomCode,
    participants: getParticipants(launch.id),
    total_participants: getParticipants(launch.id).length,
  })
}

function emitAnswerProgress(io, roomCode) {
  const launch = getLaunchByRoom(roomCode)
  if (!launch) return
  emitToRoom(io, roomCode, {
    type: 'answer_progress',
    room_code: roomCode,
    progress: getAnswerProgress(launch),
  })
}

async function closeQuestionAndBroadcast(io, launch) {
  clearTimer(launch.room_code)
  const result = closeCurrentQuestion(launch)
  if (!result) return

  const payload = { type: 'question_finished', question_id: result.question.id }
  if (result.settings.show_correct_answers_after_question) {
    payload.correct_option_ids = result.correct_option_ids
  }
  emitToRoom(io, launch.room_code, payload)

  const freshLaunch = getLaunchByRoom(launch.room_code)
  const analytics = buildQuestionAnalytics(freshLaunch, result.question, freshLaunch.current_question_index)
  await emitToRole(io, launch.room_code, 'organizer', {
    type: 'question_analytics',
    room_code: launch.room_code,
    question: analytics,
  })

  if (result.settings.show_leaderboard_after_each_question) {
    emitToRoom(io, launch.room_code, {
      type: 'leaderboard',
      items: getLeaderboard(launch.id),
    })
  }
}

async function finishQuiz(io, launch) {
  clearTimer(launch.room_code)
  clearCountdown(launch.room_code)
  if (launch.active_question_id) {
    await closeQuestionAndBroadcast(io, launch)
  }

  db.prepare(`
    UPDATE quiz_launches
    SET status = 'finished', active_question_id = NULL, question_started_at = NULL, question_expires_at = NULL, ended_at = ?
    WHERE id = ?
  `).run(nowIso(), launch.id)

  emitToRoom(io, launch.room_code, {
    type: 'launch_finished',
    room_code: launch.room_code,
    leaderboard: getLeaderboard(launch.id),
  })

  const analytics = getLaunchAnalytics(launch.room_code)
  if (analytics) {
    await emitToRole(io, launch.room_code, 'organizer', { type: 'analytics_snapshot', data: analytics })
  }
}

async function startQuestionAndBroadcast(io, launch) {
  clearCountdown(launch.room_code)
  const started = startQuestion(launch)
  if (started.finished) {
    await finishQuiz(io, getLaunchByRoom(launch.room_code))
    return
  }

  const freshLaunch = getLaunchByRoom(launch.room_code)
  emitToRoom(io, launch.room_code, {
    type: 'question_started',
    room_code: launch.room_code,
    index: started.index,
    total: started.total,
    expires_at: started.expires_at,
    question: started.question,
    answer_progress: getAnswerProgress(freshLaunch),
  })

  scheduleAutoClose(io, launch.room_code, started.expires_at * 1000)
}

function scheduleCountdown(io, launch, seconds) {
  clearCountdown(launch.room_code)
  const startsAt = Math.floor(Date.now() / 1000)
  const total = getQuestionOrder(launch).length
  const nextIndex = launch.current_question_index + 1
  const timer = setTimeout(async () => {
    const freshLaunch = getLaunchByRoom(launch.room_code)
    if (!freshLaunch || freshLaunch.status !== 'active') return
    await startQuestionAndBroadcast(io, freshLaunch)
  }, seconds * 1000)

  countdownTimers.set(launch.room_code, {
    timer,
    startsAt,
    seconds,
    nextIndex,
    total,
  })

  emitToRoom(io, launch.room_code, {
    type: 'countdown_started',
    room_code: launch.room_code,
    seconds,
    remaining_seconds: seconds,
    starts_at: startsAt,
    next_question_index: nextIndex,
    total,
  })
}

async function startOrNextQuestion(io, launch, user, mode) {
  if (launch.organizer_id !== user.id) throw new Error('Управлять квизом может только его организатор')
  if (launch.status === 'finished') throw new Error('Этот запуск уже завершен')
  if (countdownTimers.has(launch.room_code)) throw new Error('Обратный отсчет уже идет')

  let activeLaunch = getLaunchByRoom(launch.room_code)

  if (mode === 'start' && activeLaunch.status !== 'waiting') {
    throw new Error('Квиз уже запущен. Для перехода используйте кнопку следующего вопроса.')
  }

  if (mode === 'start' && activeLaunch.status === 'waiting') {
    db.prepare("UPDATE quiz_launches SET status = 'active', started_at = ? WHERE id = ?").run(nowIso(), activeLaunch.id)
    activeLaunch = getLaunchByRoom(launch.room_code)
    emitToRoom(io, launch.room_code, {
      type: 'launch_status',
      status: 'active',
      room_code: launch.room_code,
    })
  }

  if (activeLaunch.active_question_id) {
    await closeQuestionAndBroadcast(io, activeLaunch)
    activeLaunch = getLaunchByRoom(launch.room_code)
  }

  if (activeLaunch.status !== 'active') {
    db.prepare("UPDATE quiz_launches SET status = 'active', started_at = COALESCE(started_at, ?) WHERE id = ?").run(nowIso(), activeLaunch.id)
    activeLaunch = getLaunchByRoom(launch.room_code)
  }

  const total = getQuestionOrder(activeLaunch).length
  const nextIndex = activeLaunch.current_question_index + 1
  if (nextIndex >= total) {
    await finishQuiz(io, getLaunchByRoom(launch.room_code))
    return
  }

  const settings = getLaunchSettings(activeLaunch)
  if (settings.countdown_seconds > 0) {
    scheduleCountdown(io, activeLaunch, settings.countdown_seconds)
    return
  }

  await startQuestionAndBroadcast(io, activeLaunch)
}

export function setupRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: socketCorsOrigin,
      credentials: true,
    },
  })

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
    const roomCode = String(socket.handshake.auth?.roomCode || '').toUpperCase()
    const user = getUserFromToken(token)
    if (!user || !roomCode) return next(new Error('Требуется авторизация'))

    const launch = getLaunchByRoom(roomCode)
    if (!launch) return next(new Error('Комната не найдена'))
    if (user.role === 'organizer' && launch.organizer_id !== user.id) return next(new Error('Нет доступа'))

    socket.data.user = user
    socket.data.roomCode = roomCode
    return next()
  })

  io.on('connection', async (socket) => {
    const user = socket.data.user
    const roomCode = socket.data.roomCode
    let launch = getLaunchByRoom(roomCode)

    if (user.role === 'participant' && !getParticipantForUser(launch.id, user.id)) {
      const joined = joinLaunch(user, roomCode, user.full_name)
      if (joined.status >= 400) {
        socket.emit('message', { type: 'error', message: joined.detail })
        socket.disconnect(true)
        return
      }
    }

    await socket.join(roomCode)

    const state = getLaunchState(roomCode)
    socket.emit('message', {
      type: 'connected',
      room_code: roomCode,
      status: state.status,
      current_question_index: state.current_question_index,
      question_total: state.question_total,
      leaderboard: state.leaderboard,
      participants: state.participants,
      answer_progress: state.answer_progress,
      settings: state.settings,
    })

    emitLobbyState(io, roomCode)

    if (user.role === 'organizer') {
      socket.emit('message', { type: 'analytics_snapshot', data: getLaunchAnalytics(roomCode) })
    }

    const countdown = countdownTimers.get(roomCode)
    if (countdown) {
      socket.emit('message', {
        type: 'countdown_started',
        room_code: roomCode,
        seconds: countdown.seconds,
        remaining_seconds: Math.max(0, countdown.seconds - (Math.floor(Date.now() / 1000) - countdown.startsAt)),
        starts_at: countdown.startsAt,
        next_question_index: countdown.nextIndex,
        total: countdown.total,
      })
    }

    launch = getLaunchByRoom(roomCode)
    if (launch.active_question_id && launch.question_expires_at && Date.now() < launch.question_expires_at) {
      const settings = getLaunchSettings(launch)
      socket.emit('message', {
        type: 'question_started',
        room_code: roomCode,
        index: launch.current_question_index,
        total: state.question_total,
        expires_at: launch.question_expires_at / 1000,
        question: getPublicQuestion(launch.active_question_id, settings, roomCode),
        answer_progress: getAnswerProgress(launch),
      })
    }

    socket.on('message', async (message) => {
      try {
        const currentLaunch = getLaunchByRoom(roomCode)
        if (!currentLaunch) throw new Error('Комната не найдена')
        const eventType = message?.type

        if (eventType === 'submit_answer') {
          const result = submitAnswer(user, roomCode, message.option_ids)
          if (result.status >= 400) throw new Error(result.detail)
          socket.emit('message', {
            type: 'answer_received',
            ...result.data,
          })
          emitAnswerProgress(io, roomCode)
          return
        }

        if (user.role !== 'organizer') {
          throw new Error('Управлять комнатой может только организатор')
        }

        if (eventType === 'start') {
          await startOrNextQuestion(io, currentLaunch, user, 'start')
          return
        }

        if (eventType === 'next') {
          await startOrNextQuestion(io, currentLaunch, user, 'next')
          return
        }

        if (eventType === 'finish') {
          await finishQuiz(io, currentLaunch)
          return
        }

        if (eventType === 'request_analytics') {
          socket.emit('message', { type: 'analytics_snapshot', data: getLaunchAnalytics(roomCode) })
          return
        }

        if (eventType === 'ping') {
          socket.emit('message', { type: 'pong' })
        }
      } catch (error) {
        socket.emit('message', { type: 'error', message: error.message || 'Ошибка realtime-соединения' })
      }
    })
  })

  return io
}
