import { io } from 'socket.io-client'

const base = process.env.API_BASE || 'http://127.0.0.1:8000'
const suffix = `${Date.now()}-${Math.round(Math.random() * 100000)}`

const checked = []

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

function auth(token) {
  return { Authorization: `Bearer ${token}` }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function mark(name) {
  checked.push(name)
}

function createEventLog() {
  const events = []
  events.listeners = []
  return events
}

function pushEvent(events, event) {
  events.push(event)
  events.listeners.forEach((listener) => listener(event))
}

function waitForConnect(socket, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connection timeout')), timeoutMs)
    socket.on('connect', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.on('connect_error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function waitForEvent(events, type, predicate = () => true, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const existing = events.find((event) => event.type === type && predicate(event))
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

async function expectSocketError(token, roomCode) {
  const socket = io(base, {
    auth: { token, roomCode },
    transports: ['websocket'],
    timeout: 2000,
    reconnection: false,
  })

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.disconnect()
      reject(new Error('Socket connection with invalid auth was not rejected'))
    }, 3000)

    socket.on('connect', () => {
      clearTimeout(timer)
      socket.disconnect()
      reject(new Error('Socket connection with invalid auth unexpectedly succeeded'))
    })

    socket.on('connect_error', () => {
      clearTimeout(timer)
      socket.disconnect()
      resolve()
    })
  })
}

async function connectRoom(token, roomCode) {
  const events = createEventLog()
  const socket = io(base, {
    auth: { token, roomCode },
    transports: ['websocket'],
    timeout: 4000,
    reconnection: false,
  })
  socket.on('message', (event) => pushEvent(events, event))
  await waitForConnect(socket)
  await waitForEvent(events, 'connected')
  return { socket, events }
}

async function register(fullName, email, role) {
  const payload = await ok('/api/auth/register', {
    method: 'POST',
    body: {
      full_name: fullName,
      email,
      password: 'password',
      role,
    },
  })
  assert(!payload.user.password_hash, 'Auth response exposes password hash')
  return payload
}

const health = await ok('/api/health')
assert(health.ok === true, 'Health endpoint did not return ok')
mark('health endpoint')

await expectStatus('/api/auth/me', 401)
await expectStatus('/api/auth/register', 400, {
  method: 'POST',
  body: { full_name: 'A', email: 'broken', password: '1', role: 'organizer' },
})
mark('auth validation and protected routes')

const organizer = await register('QA Organizer', `qa-organizer-${suffix}@example.com`, 'organizer')
const participant = await register('QA Player', `qa-player-${suffix}@example.com`, 'participant')
const lateParticipant = await register('Late Player', `qa-late-${suffix}@example.com`, 'participant')
const otherOrganizer = await register('Other Organizer', `qa-other-${suffix}@example.com`, 'organizer')

await expectStatus('/api/auth/register', 409, {
  method: 'POST',
  body: {
    full_name: 'QA Organizer',
    email: `qa-organizer-${suffix}@example.com`,
    password: 'password',
    role: 'organizer',
  },
})
const me = await ok('/api/auth/me', { headers: auth(organizer.access_token) })
assert(me.email === `qa-organizer-${suffix}@example.com`, 'Profile endpoint returned wrong user')
const { response: cookieLoginResponse } = await request('/api/auth/login', {
  method: 'POST',
  body: {
    email: `qa-organizer-${suffix}@example.com`,
    password: 'password',
  },
})
const sessionCookie = cookieLoginResponse.headers.get('set-cookie')
assert(sessionCookie?.includes('quizhub_session='), 'Login did not set the session cookie')
assert(sessionCookie?.toLowerCase().includes('httponly'), 'Session cookie is not HttpOnly')
const cookieProfile = await ok('/api/auth/me', {
  headers: { Cookie: sessionCookie.split(';')[0] },
})
assert(cookieProfile.id === organizer.user.id, 'Cookie session returned wrong user')
mark('registration, bearer/cookie login session and duplicate email protection')

await expectStatus('/api/quizzes', 403, {
  method: 'POST',
  headers: auth(participant.access_token),
  body: { title: 'Forbidden quiz' },
})
await expectStatus('/api/quizzes', 400, {
  method: 'POST',
  headers: auth(organizer.access_token),
  body: { title: '' },
})

const quiz = await ok('/api/quizzes', {
  method: 'POST',
  headers: auth(organizer.access_token),
  body: {
    title: 'QA comprehensive quiz',
    description: 'Full regression scenario',
    category: 'Quality assurance',
    default_time_limit: 10,
    rules: 'Answer while the question is visible',
    settings: {
      randomize_question_order: false,
      randomize_answer_order: true,
      show_leaderboard_after_each_question: true,
      show_correct_answers_after_question: true,
      allow_late_join: false,
      allow_answer_change: false,
      max_attempts_per_question: 1,
      points_mode: 'accuracy',
      countdown_seconds: 0,
    },
  },
})

await expectStatus(`/api/quizzes/${quiz.id}/questions`, 400, {
  method: 'POST',
  headers: auth(organizer.access_token),
  body: {
    questions: [{
      text: 'Invalid question',
      question_type: 'single',
      options: [
        { text: 'A', is_correct: false },
        { text: 'B', is_correct: false },
      ],
    }],
  },
})

const savedQuiz = await ok(`/api/quizzes/${quiz.id}/questions`, {
  method: 'POST',
  headers: auth(organizer.access_token),
  body: {
    questions: [
      {
        text: 'Что обеспечивает обмен событиями в реальном времени?',
        image_url: 'https://example.com/realtime.png',
        question_type: 'single',
        points: 100,
        time_limit: 10,
        options: [
          { text: 'Socket.IO', is_correct: true },
          { text: 'Почтовая рассылка', is_correct: false },
          { text: 'CSV-файл', is_correct: false },
        ],
      },
      {
        text: 'Какие функции входят в административный режим?',
        question_type: 'multiple',
        points: 200,
        time_limit: 10,
        options: [
          { text: 'Статистика по вопросам', is_correct: true },
          { text: 'Прогресс участников', is_correct: true },
          { text: 'Случайная выдача паролей', is_correct: false },
        ],
      },
    ],
  },
})

await expectStatus(`/api/quizzes/${quiz.id}`, 403, { headers: auth(participant.access_token) })
await expectStatus(`/api/quizzes/${quiz.id}`, 403, { headers: auth(otherOrganizer.access_token) })
await expectStatus(`/api/quizzes/${quiz.id}`, 200, { headers: auth(organizer.access_token) })
await expectStatus(`/api/quizzes/${quiz.id}`, 403, {
  method: 'PUT',
  headers: auth(otherOrganizer.access_token),
  body: { title: 'Attempted takeover' },
})
await expectStatus(`/api/quizzes/${quiz.id}/duplicate`, 403, {
  method: 'POST',
  headers: auth(otherOrganizer.access_token),
})
await expectStatus(`/api/quizzes/${quiz.id}`, 403, {
  method: 'DELETE',
  headers: auth(otherOrganizer.access_token),
})
const duplicatedQuiz = await ok(`/api/quizzes/${quiz.id}/duplicate`, {
  method: 'POST',
  headers: auth(organizer.access_token),
})
assert(duplicatedQuiz.title.endsWith('— копия'), 'Duplicated quiz title is wrong')
assert(duplicatedQuiz.questions.length === savedQuiz.questions.length, 'Duplicated quiz lost questions')
await expectStatus(`/api/quizzes/${duplicatedQuiz.id}`, 204, {
  method: 'DELETE',
  headers: auth(organizer.access_token),
})
await expectStatus(`/api/quizzes/${duplicatedQuiz.id}`, 404, {
  headers: auth(organizer.access_token),
})
mark('quiz validation, ownership, duplication and deletion')

const launch = await ok('/api/sessions', {
  method: 'POST',
  headers: auth(organizer.access_token),
  body: { quiz_id: quiz.id },
})

await expectStatus(`/api/sessions/${launch.room_code}`, 403, { headers: auth(participant.access_token) })
await expectStatus(`/api/sessions/${launch.room_code}/analytics`, 403, { headers: auth(participant.access_token) })
await expectStatus(`/api/sessions/${launch.room_code}`, 403, { headers: auth(otherOrganizer.access_token) })
await expectStatus(`/api/sessions/${launch.room_code}/analytics`, 403, { headers: auth(otherOrganizer.access_token) })
await expectStatus(`/api/sessions/${launch.room_code}/raw`, 403, { headers: auth(otherOrganizer.access_token) })
await expectSocketError('broken-token', launch.room_code)
mark('room, analytics and socket access control')

const joined = await ok(`/api/sessions/${launch.room_code}/join`, {
  method: 'POST',
  headers: auth(participant.access_token),
  body: { display_name: 'QA Player' },
})
assert(joined.room_code === launch.room_code, 'Participant joined wrong room')
const renamed = await ok(`/api/sessions/${launch.room_code}/join`, {
  method: 'POST',
  headers: auth(participant.access_token),
  body: { display_name: 'QA Player Renamed' },
})
assert(renamed.display_name === 'QA Player Renamed', 'Repeated join did not update display name')
mark('participant join and display name update')

const host = await connectRoom(organizer.access_token, launch.room_code)
const player = await connectRoom(participant.access_token, launch.room_code)
await waitForEvent(host.events, 'lobby_state', (event) => event.total_participants === 1)

host.socket.emit('message', { type: 'start' })
const hostQuestion1 = await waitForEvent(host.events, 'question_started', (event) => event.index === 0)
const playerQuestion1 = await waitForEvent(player.events, 'question_started', (event) => event.index === 0)
assert(playerQuestion1.answer_progress.total_participants === 1, 'Initial answer progress total is wrong')
assert(playerQuestion1.answer_progress.answered_count === 0, 'Initial answer progress answered count is wrong')
assert(playerQuestion1.question.options.every((option) => option.is_correct === undefined), 'Public question exposes correct answers')
assert(
  JSON.stringify(hostQuestion1.question.options.map((option) => option.id)) === JSON.stringify(playerQuestion1.question.options.map((option) => option.id)),
  'Randomized answer order differs between host and participant',
)
await expectStatus(`/api/sessions/${launch.room_code}/join`, 403, {
  method: 'POST',
  headers: auth(lateParticipant.access_token),
  body: { display_name: 'Late Player' },
})
mark('live start, public question safety and late join restriction')

player.socket.emit('message', { type: 'submit_answer', option_ids: [] })
await waitForEvent(player.events, 'error', (event) => String(event.message || '').includes('Выберите'))
player.socket.emit('message', { type: 'submit_answer', option_ids: [999999] })
await waitForEvent(player.events, 'error', (event) => String(event.message || '').includes('Выберите'))
const q1Correct = savedQuiz.questions[0].options.find((option) => option.is_correct).id
player.socket.emit('message', { type: 'submit_answer', option_ids: [q1Correct] })
await waitForEvent(player.events, 'answer_received', (event) => event.question_id === savedQuiz.questions[0].id && event.attempt_count === 1)
await waitForEvent(host.events, 'answer_progress', (event) => event.progress?.answered_count === 1 && event.progress?.pending_count === 0)
player.socket.emit('message', { type: 'submit_answer', option_ids: [savedQuiz.questions[0].options.find((option) => !option.is_correct).id] })
await waitForEvent(player.events, 'error', (event) => String(event.message || '').includes('Изменение ответа запрещено'))
mark('answer validation, invalid options, answer-change restriction and live answer progress')

host.socket.emit('message', { type: 'next' })
await waitForEvent(player.events, 'question_finished', (event) => event.question_id === savedQuiz.questions[0].id && event.correct_option_ids?.includes(q1Correct))
await waitForEvent(player.events, 'leaderboard', (event) => event.items?.[0]?.total_score === 100)
await waitForEvent(player.events, 'question_started', (event) => event.index === 1)

const q2Correct = savedQuiz.questions[1].options.filter((option) => option.is_correct).map((option) => option.id)
player.socket.emit('message', { type: 'submit_answer', option_ids: q2Correct })
await waitForEvent(player.events, 'answer_received', (event) => event.question_id === savedQuiz.questions[1].id)
host.socket.emit('message', { type: 'finish' })
await waitForEvent(player.events, 'launch_finished', (event) => event.leaderboard?.[0]?.total_score === 300)
await waitForEvent(host.events, 'analytics_snapshot', (event) => event.data?.status === 'finished')
mark('multi-question realtime flow, scoring and final leaderboard')

host.socket.disconnect()
player.socket.disconnect()

const analytics = await ok(`/api/sessions/${launch.room_code}/analytics`, {
  headers: auth(organizer.access_token),
})
assert(analytics.total_participants === 1, 'Analytics participant count is wrong')
assert(analytics.question_stats.length === 2, 'Analytics question count is wrong')
assert(analytics.question_stats[0].accuracy_percent === 100, 'Question 1 accuracy is wrong')
assert(analytics.question_stats[1].answers_count === 1, 'Question 2 answers count is wrong')
assert(analytics.participant_stats[0].total_score === 300, 'Participant total score is wrong')
assert(analytics.participant_stats[0].by_question.length === 2, 'Participant per-question analytics missing')
assert(analytics.insights.summary.length > 0, 'Teacher insights summary missing')
assert(analytics.insights.top_performers[0]?.display_name === 'QA Player Renamed', 'Teacher insights top performer missing')

await expectStatus(`/api/sessions/${launch.room_code}/export.csv`, 403, { headers: auth(participant.access_token) })
await expectStatus(`/api/sessions/${launch.room_code}/export.csv`, 403, { headers: auth(otherOrganizer.access_token) })
const { response: exportResponse, payload: exportCsv } = await request(`/api/sessions/${launch.room_code}/export.csv`, {
  headers: auth(organizer.access_token),
})
assert(exportResponse.status === 200, 'Organizer export did not return 200')
assert(exportResponse.headers.get('content-type')?.includes('text/csv'), 'Export is not CSV')
assert(String(exportCsv).includes('QA Player Renamed'), 'Export misses participant')
assert(String(exportCsv).includes('Что обеспечивает обмен событиями'), 'Export misses question text')

const organizerHistory = await ok('/api/history', { headers: auth(organizer.access_token) })
const participantHistory = await ok('/api/history', { headers: auth(participant.access_token) })
assert(organizerHistory.items.some((item) => item.room_code === launch.room_code), 'Organizer history missed launch')
assert(participantHistory.items.some((item) => item.room_code === launch.room_code && item.score === 300), 'Participant history missed score')
mark('admin analytics, smart teacher insights, CSV export and personal history')

const retryQuiz = await ok('/api/quizzes', {
  method: 'POST',
  headers: auth(organizer.access_token),
  body: {
    title: 'QA retry quiz',
    description: 'Answer change scenario',
    category: 'Quality assurance',
    default_time_limit: 10,
    rules: '',
    settings: {
      allow_late_join: true,
      allow_answer_change: true,
      max_attempts_per_question: 2,
      points_mode: 'accuracy',
      show_leaderboard_after_each_question: true,
      show_correct_answers_after_question: true,
      countdown_seconds: 0,
    },
  },
})
const retrySaved = await ok(`/api/quizzes/${retryQuiz.id}/questions`, {
  method: 'POST',
  headers: auth(organizer.access_token),
  body: {
    questions: [{
      text: 'Можно ли обновить ответ до лимита попыток?',
      question_type: 'single',
      points: 100,
      time_limit: 10,
      options: [
        { text: 'Да', is_correct: true },
        { text: 'Нет', is_correct: false },
      ],
    }],
  },
})
const retryLaunch = await ok('/api/sessions', {
  method: 'POST',
  headers: auth(organizer.access_token),
  body: { quiz_id: retryQuiz.id },
})
await ok(`/api/sessions/${retryLaunch.room_code}/join`, {
  method: 'POST',
  headers: auth(participant.access_token),
  body: { display_name: 'QA Retry Player' },
})
const retryHost = await connectRoom(organizer.access_token, retryLaunch.room_code)
const retryPlayer = await connectRoom(participant.access_token, retryLaunch.room_code)
retryHost.socket.emit('message', { type: 'start' })
await waitForEvent(retryPlayer.events, 'question_started')
const retryWrong = retrySaved.questions[0].options.find((option) => !option.is_correct).id
const retryCorrect = retrySaved.questions[0].options.find((option) => option.is_correct).id
retryPlayer.socket.emit('message', { type: 'submit_answer', option_ids: [retryWrong] })
await waitForEvent(retryPlayer.events, 'answer_received', (event) => event.attempt_count === 1)
retryPlayer.socket.emit('message', { type: 'submit_answer', option_ids: [retryCorrect] })
await waitForEvent(retryPlayer.events, 'answer_received', (event) => event.attempt_count === 2)
retryPlayer.socket.emit('message', { type: 'submit_answer', option_ids: [retryWrong] })
await waitForEvent(retryPlayer.events, 'error', (event) => String(event.message || '').includes('лимит попыток'))
retryHost.socket.emit('message', { type: 'finish' })
await waitForEvent(retryPlayer.events, 'launch_finished')
retryHost.socket.disconnect()
retryPlayer.socket.disconnect()
const retryAnalytics = await ok(`/api/sessions/${retryLaunch.room_code}/analytics`, {
  headers: auth(organizer.access_token),
})
assert(retryAnalytics.participant_stats[0].total_score === 100, 'Updated answer was not used for scoring')
mark('answer updates and attempt limits')

const clampedQuiz = await ok('/api/quizzes', {
  method: 'POST',
  headers: auth(organizer.access_token),
  body: {
    title: 'QA settings clamp',
    description: '',
    category: '',
    default_time_limit: 999,
    rules: '',
    settings: {
      max_attempts_per_question: 99,
      points_mode: 'unknown',
    },
  },
})
assert(clampedQuiz.default_time_limit === 180, 'Default timer was not clamped')
assert(clampedQuiz.settings.max_attempts_per_question === 10, 'Attempt limit was not clamped')
assert(clampedQuiz.settings.points_mode === 'speed', 'Invalid points mode was not normalized')
assert(clampedQuiz.settings.countdown_seconds === 0, 'Countdown default was not normalized')
mark('settings normalization')

const countdownQuiz = await ok('/api/quizzes', {
  method: 'POST',
  headers: auth(organizer.access_token),
  body: {
    title: 'QA countdown quiz',
    description: 'Countdown scenario',
    category: 'Quality assurance',
    default_time_limit: 5,
    rules: '',
    settings: {
      randomize_question_order: false,
      randomize_answer_order: false,
      show_leaderboard_after_each_question: true,
      show_correct_answers_after_question: true,
      allow_late_join: true,
      allow_answer_change: true,
      max_attempts_per_question: 1,
      points_mode: 'accuracy',
      countdown_seconds: 1,
    },
  },
})
await ok(`/api/quizzes/${countdownQuiz.id}/questions`, {
  method: 'POST',
  headers: auth(organizer.access_token),
  body: {
    questions: [{
      text: 'Отсчет запускает вопрос автоматически?',
      question_type: 'single',
      points: 50,
      time_limit: 5,
      options: [
        { text: 'Да', is_correct: true },
        { text: 'Нет', is_correct: false },
      ],
    }],
  },
})
const countdownLaunch = await ok('/api/sessions', {
  method: 'POST',
  headers: auth(organizer.access_token),
  body: { quiz_id: countdownQuiz.id },
})
await ok(`/api/sessions/${countdownLaunch.room_code}/join`, {
  method: 'POST',
  headers: auth(participant.access_token),
  body: { display_name: 'Countdown Player' },
})
const countdownHost = await connectRoom(organizer.access_token, countdownLaunch.room_code)
const countdownPlayer = await connectRoom(participant.access_token, countdownLaunch.room_code)
countdownHost.socket.emit('message', { type: 'start' })
await waitForEvent(countdownPlayer.events, 'countdown_started', (event) => event.remaining_seconds === 1)
await waitForEvent(countdownPlayer.events, 'question_started', (event) => event.index === 0, 3000)
countdownHost.socket.emit('message', { type: 'finish' })
await waitForEvent(countdownPlayer.events, 'launch_finished')
countdownHost.socket.disconnect()
countdownPlayer.socket.disconnect()
mark('countdown before question')

const { response: corsResponse } = await request('/api/health', {
  headers: { Origin: 'https://evil.example' },
})
assert(!corsResponse.headers.get('access-control-allow-origin'), 'Unknown origin received CORS access')
assert(corsResponse.headers.get('content-security-policy')?.includes("default-src 'self'"), 'CSP header is missing')
mark('CORS and Content Security Policy restrictions')

console.log(JSON.stringify({
  ok: true,
  base,
  checked,
  primary_room_code: launch.room_code,
  retry_room_code: retryLaunch.room_code,
}, null, 2))
