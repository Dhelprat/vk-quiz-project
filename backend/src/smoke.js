import { io } from 'socket.io-client'

const base = process.env.API_BASE || 'http://127.0.0.1:8000'
const suffix = Date.now()

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json') ? await response.json() : await response.text()
  return { response, payload }
}

async function ok(path, options = {}) {
  const { response, payload } = await request(path, options)
  if (!response.ok) throw new Error(`${path}: ${response.status} ${payload.detail || JSON.stringify(payload)}`)
  return payload
}

async function expectStatus(path, expectedStatus, options = {}) {
  const { response, payload } = await request(path, options)
  if (response.status !== expectedStatus) {
    throw new Error(`${path}: expected ${expectedStatus}, got ${response.status}: ${payload.detail || JSON.stringify(payload)}`)
  }
  return payload
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    socket.on('connect', resolve)
    socket.on('connect_error', reject)
    setTimeout(() => reject(new Error('Socket connection timeout')), 4000)
  })
}

function waitForEvent(events, type, predicate = () => true, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const existing = events.find((item) => item.type === type && predicate(item))
    if (existing) return resolve(existing)
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs)
    events.listeners.push((event) => {
      if (event.type === type && predicate(event)) {
        clearTimeout(timer)
        resolve(event)
      }
    })
  })
}

function pushEvent(events, event) {
  events.push(event)
  events.listeners.forEach((listener) => listener(event))
}

const organizer = await ok('/api/auth/register', {
  method: 'POST',
  body: {
    full_name: 'Demo Organizer',
    email: `organizer-${suffix}@example.com`,
    password: 'password',
    role: 'organizer',
  },
})

const participant = await ok('/api/auth/register', {
  method: 'POST',
  body: {
    full_name: 'Demo Player',
    email: `player-${suffix}@example.com`,
    password: 'password',
    role: 'participant',
  },
})

const quiz = await ok('/api/quizzes', {
  method: 'POST',
  headers: { Authorization: `Bearer ${organizer.access_token}` },
  body: {
    title: 'Smoke quiz',
    description: 'Automated smoke check',
    category: 'QA',
    default_time_limit: 8,
    rules: 'Answer fast',
    settings: {
      randomize_question_order: false,
      randomize_answer_order: true,
      show_leaderboard_after_each_question: true,
      show_correct_answers_after_question: true,
      allow_late_join: true,
      allow_answer_change: true,
      max_attempts_per_question: 2,
      points_mode: 'accuracy',
      countdown_seconds: 0,
    },
  },
})

const savedQuiz = await ok(`/api/quizzes/${quiz.id}/questions`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${organizer.access_token}` },
  body: {
    questions: [
      {
        text: 'Какой транспорт используется для realtime?',
        question_type: 'single',
        points: 100,
        time_limit: 8,
        options: [
          { text: 'Socket.IO', is_correct: true },
          { text: 'Email', is_correct: false },
        ],
      },
    ],
  },
})

await expectStatus(`/api/quizzes/${quiz.id}`, 403, {
  headers: { Authorization: `Bearer ${participant.access_token}` },
})

const launch = await ok('/api/sessions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${organizer.access_token}` },
  body: { quiz_id: quiz.id },
})

await ok(`/api/sessions/${launch.room_code}/join`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${participant.access_token}` },
  body: { display_name: 'Demo Player' },
})

const correctOptionId = savedQuiz.questions[0].options.find((option) => option.is_correct).id
const hostEvents = []
hostEvents.listeners = []
const playerEvents = []
playerEvents.listeners = []

const host = io(base, {
  auth: { token: organizer.access_token, roomCode: launch.room_code },
  transports: ['websocket'],
})
const player = io(base, {
  auth: { token: participant.access_token, roomCode: launch.room_code },
  transports: ['websocket'],
})

host.on('message', (event) => pushEvent(hostEvents, event))
player.on('message', (event) => pushEvent(playerEvents, event))

await Promise.all([waitForConnect(host), waitForConnect(player)])
await waitForEvent(hostEvents, 'connected')
await waitForEvent(playerEvents, 'connected')
host.emit('message', { type: 'start' })

await waitForEvent(playerEvents, 'question_started')
player.emit('message', { type: 'submit_answer', option_ids: [] })
const emptyAnswerError = await waitForEvent(playerEvents, 'error')
if (!String(emptyAnswerError.message || '').includes('Выберите')) {
  throw new Error('Empty answer validation did not work')
}

player.emit('message', { type: 'submit_answer', option_ids: [correctOptionId] })
await waitForEvent(playerEvents, 'answer_received')
await waitForEvent(hostEvents, 'answer_progress', (event) => event.progress?.answered_count === 1)
host.emit('message', { type: 'finish' })
await waitForEvent(playerEvents, 'launch_finished')

host.disconnect()
player.disconnect()

const analytics = await ok(`/api/sessions/${launch.room_code}/analytics`, {
  headers: { Authorization: `Bearer ${organizer.access_token}` },
})

if (analytics.participant_stats[0]?.total_score !== 100) {
  throw new Error('Score calculation failed')
}
if (analytics.question_stats[0]?.accuracy_percent !== 100) {
  throw new Error('Question analytics failed')
}
if (!analytics.insights?.summary?.length) {
  throw new Error('Teacher insights missing')
}

const { response: exportResponse, payload: exportCsv } = await request(`/api/sessions/${launch.room_code}/export.csv`, {
  headers: { Authorization: `Bearer ${organizer.access_token}` },
})
if (!exportResponse.ok || !String(exportCsv).includes('Demo Player') || !String(exportCsv).includes('Smoke quiz')) {
  throw new Error('CSV export failed')
}

console.log(JSON.stringify({
  ok: true,
  room_code: launch.room_code,
  checked: [
    'registration',
    'quiz builder',
    'participant cannot read correct answers',
    'room join',
    'Socket.IO live question',
    'empty answer rejected',
    'answer accepted',
    'answer progress broadcast',
    'finish quiz',
    'leaderboard and analytics',
    'teacher insights',
    'CSV export',
  ],
  leaderboard: analytics.participant_stats,
}, null, 2))
