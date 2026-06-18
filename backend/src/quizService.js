import crypto from 'node:crypto'

import { asBool, db, mergeSettings, nowIso, parseJson, stringifyJson } from './db.js'

function clampInt(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function normalizeString(value, fallback = '') {
  if (value == null) return fallback
  return String(value).trim()
}

function getQuizRow(quizId) {
  return db.prepare('SELECT * FROM quizzes WHERE id = ?').get(quizId)
}

function getQuestionRows(quizId) {
  return db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY order_index ASC, id ASC').all(quizId)
}

function getOptionRows(questionId) {
  return db.prepare('SELECT * FROM question_options WHERE question_id = ? ORDER BY order_index ASC, id ASC').all(questionId)
}

function serializeOption(row, includeAnswer = true) {
  const option = {
    id: row.id,
    text: row.text,
  }
  if (includeAnswer) option.is_correct = asBool(row.is_correct)
  return option
}

function serializeQuestion(row, includeAnswers = true, optionOrder = null) {
  const optionRows = getOptionRows(row.id)
  const orderedOptions = optionOrder
    ? optionOrder.map((id) => optionRows.find((option) => option.id === id)).filter(Boolean)
    : optionRows

  return {
    id: row.id,
    text: row.text,
    image_url: row.image_url || null,
    question_type: row.question_type,
    points: row.points,
    time_limit: row.time_limit,
    options: orderedOptions.map((option) => serializeOption(option, includeAnswers)),
  }
}

export function serializeQuiz(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    default_time_limit: row.default_time_limit,
    rules: row.rules,
    settings: mergeSettings(row.settings),
    created_at: row.created_at,
  }
}

export function getQuizDetails(quizId) {
  const quiz = getQuizRow(quizId)
  if (!quiz) return null
  const questions = getQuestionRows(quizId).map((question) => serializeQuestion(question, true))
  return { ...serializeQuiz(quiz), questions }
}

export function getMyQuizzes(userId) {
  return db
    .prepare('SELECT * FROM quizzes WHERE owner_id = ? ORDER BY id DESC')
    .all(userId)
    .map(serializeQuiz)
}

function validateQuizPayload(payload, partial = false) {
  const result = {}

  if (!partial || payload.title !== undefined) {
    const title = normalizeString(payload.title)
    if (title.length < 2 || title.length > 200) throw new Error('Название квиза должно быть от 2 до 200 символов')
    result.title = title
  }

  if (!partial || payload.description !== undefined) {
    result.description = normalizeString(payload.description)
  }

  if (!partial || payload.category !== undefined) {
    result.category = normalizeString(payload.category, 'General').slice(0, 80) || 'General'
  }

  if (!partial || payload.default_time_limit !== undefined) {
    result.default_time_limit = clampInt(payload.default_time_limit, 20, 5, 180)
  }

  if (!partial || payload.rules !== undefined) {
    result.rules = normalizeString(payload.rules)
  }

  if (!partial || payload.settings !== undefined) {
    result.settings = mergeSettings(payload.settings || {})
  }

  return result
}

export function createQuiz(ownerId, payload) {
  const quiz = validateQuizPayload(payload)
  const timestamp = nowIso()
  const stmt = db.prepare(`
    INSERT INTO quizzes (owner_id, title, description, category, default_time_limit, rules, settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const info = stmt.run(
    ownerId,
    quiz.title,
    quiz.description,
    quiz.category,
    quiz.default_time_limit,
    quiz.rules,
    stringifyJson(quiz.settings),
    timestamp,
    timestamp,
  )
  return serializeQuiz(getQuizRow(info.lastInsertRowid))
}

export function updateQuiz(ownerId, quizId, payload) {
  const existing = getQuizRow(quizId)
  if (!existing) return { status: 404, detail: 'Квиз не найден' }
  if (existing.owner_id !== ownerId) return { status: 403, detail: 'Нет доступа' }

  const updates = validateQuizPayload(payload, true)
  const next = {
    title: updates.title ?? existing.title,
    description: updates.description ?? existing.description,
    category: updates.category ?? existing.category,
    default_time_limit: updates.default_time_limit ?? existing.default_time_limit,
    rules: updates.rules ?? existing.rules,
    settings: updates.settings ?? mergeSettings(existing.settings),
  }

  db.prepare(`
    UPDATE quizzes
    SET title = ?, description = ?, category = ?, default_time_limit = ?, rules = ?, settings = ?, updated_at = ?
    WHERE id = ?
  `).run(
    next.title,
    next.description,
    next.category,
    next.default_time_limit,
    next.rules,
    stringifyJson(next.settings),
    nowIso(),
    quizId,
  )

  return { status: 200, data: serializeQuiz(getQuizRow(quizId)) }
}

export function duplicateQuiz(ownerId, quizId) {
  const source = getQuizRow(quizId)
  if (!source) return { status: 404, detail: 'Квиз не найден' }
  if (source.owner_id !== ownerId) return { status: 403, detail: 'Нет доступа' }

  const sourceQuestions = getQuizDetails(quizId).questions
  const created = createQuiz(ownerId, {
    title: `${source.title} — копия`.slice(0, 200),
    description: source.description,
    category: source.category,
    default_time_limit: source.default_time_limit,
    rules: source.rules,
    settings: mergeSettings(source.settings),
  })
  replaceQuestions(ownerId, created.id, {
    questions: sourceQuestions.map((question) => ({
      text: question.text,
      image_url: question.image_url,
      question_type: question.question_type,
      points: question.points,
      time_limit: question.time_limit,
      options: question.options.map((option) => ({
        text: option.text,
        is_correct: option.is_correct,
      })),
    })),
  })
  return { status: 201, data: getQuizDetails(created.id) }
}

export function deleteQuiz(ownerId, quizId) {
  const quiz = getQuizRow(quizId)
  if (!quiz) return { status: 404, detail: 'Квиз не найден' }
  if (quiz.owner_id !== ownerId) return { status: 403, detail: 'Нет доступа' }

  const activeLaunch = db
    .prepare("SELECT id FROM quiz_launches WHERE quiz_id = ? AND status IN ('waiting', 'active') LIMIT 1")
    .get(quizId)
  if (activeLaunch) return { status: 409, detail: 'Нельзя удалить квиз с активной комнатой' }

  db.prepare('DELETE FROM quizzes WHERE id = ?').run(quizId)
  return { status: 204 }
}

function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length < 1) throw new Error('Добавьте хотя бы один вопрос')
  if (questions.length > 50) throw new Error('В MVP можно добавить не более 50 вопросов')

  return questions.map((question, questionIndex) => {
    const text = normalizeString(question.text)
    if (!text) throw new Error(`Вопрос ${questionIndex + 1}: заполните текст`)

    const questionType = question.question_type === 'multiple' ? 'multiple' : 'single'
    const options = Array.isArray(question.options) ? question.options : []
    if (options.length < 2 || options.length > 8) {
      throw new Error(`Вопрос ${questionIndex + 1}: должно быть от 2 до 8 вариантов ответа`)
    }

    const cleanOptions = options.map((option) => ({
      text: normalizeString(option.text),
      is_correct: Boolean(option.is_correct),
    }))

    if (cleanOptions.some((option) => !option.text)) {
      throw new Error(`Вопрос ${questionIndex + 1}: заполните все варианты ответа`)
    }

    const correctCount = cleanOptions.filter((option) => option.is_correct).length
    if (correctCount < 1) throw new Error(`Вопрос ${questionIndex + 1}: отметьте правильный ответ`)
    if (questionType === 'single' && correctCount !== 1) {
      throw new Error(`Вопрос ${questionIndex + 1}: для одиночного выбора должен быть ровно один правильный ответ`)
    }

    return {
      text,
      image_url: normalizeString(question.image_url) || null,
      question_type: questionType,
      points: clampInt(question.points, 100, 1, 1000),
      time_limit: clampInt(question.time_limit, 20, 5, 180),
      options: cleanOptions,
    }
  })
}

export function replaceQuestions(ownerId, quizId, payload) {
  const quiz = getQuizRow(quizId)
  if (!quiz) return { status: 404, detail: 'Квиз не найден' }
  if (quiz.owner_id !== ownerId) return { status: 403, detail: 'Нет доступа' }

  const questions = validateQuestions(payload.questions)
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM questions WHERE quiz_id = ?').run(quizId)

    const insertQuestion = db.prepare(`
      INSERT INTO questions (quiz_id, order_index, text, image_url, question_type, points, time_limit)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const insertOption = db.prepare(`
      INSERT INTO question_options (question_id, order_index, text, is_correct)
      VALUES (?, ?, ?, ?)
    `)

    questions.forEach((question, questionIndex) => {
      const info = insertQuestion.run(
        quizId,
        questionIndex,
        question.text,
        question.image_url,
        question.question_type,
        question.points,
        question.time_limit,
      )
      question.options.forEach((option, optionIndex) => {
        insertOption.run(info.lastInsertRowid, optionIndex, option.text, option.is_correct ? 1 : 0)
      })
    })

    db.prepare('UPDATE quizzes SET updated_at = ? WHERE id = ?').run(nowIso(), quizId)
  })

  tx()
  return { status: 200, data: getQuizDetails(quizId) }
}

function shuffle(values) {
  const copy = [...values]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function deterministicShuffle(values, seed) {
  return [...values].sort((left, right) => {
    const leftHash = crypto.createHash('sha256').update(`${seed}:${left}`).digest('hex')
    const rightHash = crypto.createHash('sha256').update(`${seed}:${right}`).digest('hex')
    return leftHash.localeCompare(rightHash)
  })
}

export function buildQuestionOrder(quizId, settings) {
  const ids = getQuestionRows(quizId).map((question) => question.id)
  return settings.randomize_question_order ? shuffle(ids) : ids
}

export function generateRoomCode(length = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  for (let i = 0; i < length; i += 1) {
    result += alphabet[crypto.randomInt(alphabet.length)]
  }
  return result
}

export function createLaunch(organizerId, quizId) {
  const quiz = getQuizRow(quizId)
  if (!quiz) return { status: 404, detail: 'Квиз не найден' }
  if (quiz.owner_id !== organizerId) return { status: 403, detail: 'Нет доступа' }

  const questions = getQuestionRows(quizId)
  if (questions.length === 0) return { status: 400, detail: 'В квизе должен быть хотя бы один вопрос' }

  const settings = mergeSettings(quiz.settings)
  const questionOrder = buildQuestionOrder(quizId, settings)
  let roomCode = generateRoomCode()
  while (db.prepare('SELECT id FROM quiz_launches WHERE room_code = ?').get(roomCode)) {
    roomCode = generateRoomCode()
  }

  const timestamp = nowIso()
  const info = db.prepare(`
    INSERT INTO quiz_launches
      (quiz_id, organizer_id, room_code, status, current_question_index, question_order, settings, created_at)
    VALUES (?, ?, ?, 'waiting', -1, ?, ?, ?)
  `).run(quizId, organizerId, roomCode, stringifyJson(questionOrder), stringifyJson(settings), timestamp)

  return { status: 201, data: serializeLaunch(db.prepare('SELECT * FROM quiz_launches WHERE id = ?').get(info.lastInsertRowid)) }
}

export function getLaunchByRoom(roomCode) {
  return db.prepare('SELECT * FROM quiz_launches WHERE room_code = ?').get(String(roomCode || '').toUpperCase())
}

export function serializeLaunch(row) {
  return {
    id: row.id,
    quiz_id: row.quiz_id,
    organizer_id: row.organizer_id,
    room_code: row.room_code,
    status: row.status,
    current_question_index: row.current_question_index,
    started_at: row.started_at,
    ended_at: row.ended_at,
  }
}

export function getLaunchSettings(launch) {
  return mergeSettings(launch.settings)
}

export function getQuestionOrder(launch) {
  const order = parseJson(launch.question_order, [])
  if (Array.isArray(order) && order.length) return order
  const settings = getLaunchSettings(launch)
  return buildQuestionOrder(launch.quiz_id, settings)
}

export function joinLaunch(user, roomCode, displayName) {
  const launch = getLaunchByRoom(roomCode)
  if (!launch) return { status: 404, detail: 'Комната не найдена' }
  if (launch.status === 'finished') return { status: 400, detail: 'Этот запуск уже завершен' }

  const existing = db
    .prepare('SELECT * FROM launch_participants WHERE launch_id = ? AND user_id = ?')
    .get(launch.id, user.id)

  const settings = getLaunchSettings(launch)
  if (launch.status === 'active' && !settings.allow_late_join && !existing) {
    return { status: 403, detail: 'Подключение после старта запрещено настройками квиза' }
  }

  const safeName = normalizeString(displayName, user.full_name).slice(0, 120) || user.full_name
  let participant
  if (existing) {
    db.prepare('UPDATE launch_participants SET display_name = ? WHERE id = ?').run(safeName, existing.id)
    participant = db.prepare('SELECT * FROM launch_participants WHERE id = ?').get(existing.id)
  } else {
    const info = db.prepare(`
      INSERT INTO launch_participants (launch_id, user_id, display_name, joined_at)
      VALUES (?, ?, ?, ?)
    `).run(launch.id, user.id, safeName, nowIso())
    participant = db.prepare('SELECT * FROM launch_participants WHERE id = ?').get(info.lastInsertRowid)
  }

  return {
    status: 200,
    data: {
      launch_id: launch.id,
      room_code: launch.room_code,
      participant_id: participant.id,
      display_name: participant.display_name,
    },
  }
}

export function getLeaderboard(launchId) {
  return db
    .prepare(`
      SELECT id, display_name, total_score, answered_count, correct_count
      FROM launch_participants
      WHERE launch_id = ?
      ORDER BY total_score DESC, joined_at ASC, id ASC
    `)
    .all(launchId)
    .map((row) => ({
      participant_id: row.id,
      display_name: row.display_name,
      total_score: row.total_score,
      answered_count: row.answered_count,
      correct_count: row.correct_count,
    }))
}

export function getParticipants(launchId) {
  return db
    .prepare(`
      SELECT id, display_name, total_score, answered_count, correct_count, joined_at
      FROM launch_participants
      WHERE launch_id = ?
      ORDER BY joined_at ASC, id ASC
    `)
    .all(launchId)
    .map((row) => ({
      participant_id: row.id,
      display_name: row.display_name,
      total_score: row.total_score,
      answered_count: row.answered_count,
      correct_count: row.correct_count,
      joined_at: row.joined_at,
    }))
}

export function getAnswerProgress(launch) {
  if (!launch?.active_question_id) {
    return {
      question_id: null,
      total_participants: getParticipants(launch.id).length,
      answered_count: 0,
      pending_count: getParticipants(launch.id).length,
    }
  }

  const totalParticipants = db
    .prepare('SELECT COUNT(*) AS total FROM launch_participants WHERE launch_id = ?')
    .get(launch.id).total
  const answeredCount = db
    .prepare(`
      SELECT COUNT(DISTINCT participant_id) AS total
      FROM answers
      WHERE launch_id = ? AND question_id = ?
    `)
    .get(launch.id, launch.active_question_id).total

  return {
    question_id: launch.active_question_id,
    total_participants: totalParticipants,
    answered_count: answeredCount,
    pending_count: Math.max(0, totalParticipants - answeredCount),
  }
}

export function getLaunchState(roomCode) {
  const launch = getLaunchByRoom(roomCode)
  if (!launch) return null
  return {
    room_code: launch.room_code,
    status: launch.status,
    current_question_index: launch.current_question_index,
    question_total: getQuestionOrder(launch).length,
    leaderboard: getLeaderboard(launch.id),
    participants: getParticipants(launch.id),
    answer_progress: getAnswerProgress(launch),
    settings: getLaunchSettings(launch),
  }
}

export function getVisibleLeaderboard(launch, role) {
  if (role === 'organizer' || launch.status === 'finished') return getLeaderboard(launch.id)
  const settings = getLaunchSettings(launch)
  return settings.show_leaderboard_after_each_question ? getLeaderboard(launch.id) : []
}

export function getQuestionById(questionId) {
  return db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId)
}

export function getPublicQuestion(questionId, settings, seed = '') {
  const question = getQuestionById(questionId)
  if (!question) return null
  let optionOrder = getOptionRows(question.id).map((option) => option.id)
  if (settings.randomize_answer_order) {
    optionOrder = seed ? deterministicShuffle(optionOrder, `${seed}:${question.id}`) : shuffle(optionOrder)
  }
  return serializeQuestion(question, false, optionOrder)
}

function selectedOptionIds(answer) {
  return parseJson(answer.selected_option_ids, [])
}

function isAnswerCorrect(question, optionIds) {
  const correct = new Set(getOptionRows(question.id).filter((option) => asBool(option.is_correct)).map((option) => option.id))
  const selected = new Set(optionIds)
  if (selected.size === 0 || selected.size !== correct.size) return false
  for (const id of selected) {
    if (!correct.has(id)) return false
  }
  return true
}

function calculatePoints(question, isCorrect, responseTimeMs, pointsMode) {
  if (!isCorrect || pointsMode === 'disabled') return 0
  if (pointsMode === 'accuracy') return question.points

  const timerMs = Math.max(question.time_limit * 1000, 1)
  const responseMs = Math.max(0, Math.min(responseTimeMs ?? timerMs, timerMs))
  const scoreFactor = 1 - responseMs / timerMs / 2
  return Math.max(0, Math.round(question.points * scoreFactor))
}

export function recalculateParticipantStats(launchId) {
  const participants = db.prepare('SELECT * FROM launch_participants WHERE launch_id = ?').all(launchId)
  const answersByParticipant = db.prepare('SELECT * FROM answers WHERE launch_id = ? AND participant_id = ?')
  const update = db.prepare(`
    UPDATE launch_participants
    SET total_score = ?, answered_count = ?, correct_count = ?
    WHERE id = ?
  `)

  participants.forEach((participant) => {
    const answers = answersByParticipant.all(launchId, participant.id)
    const totalScore = answers.reduce((sum, answer) => sum + answer.points_awarded, 0)
    const correctCount = answers.filter((answer) => asBool(answer.is_correct)).length
    update.run(totalScore, answers.length, correctCount, participant.id)
  })
}

export function closeCurrentQuestion(launch) {
  if (!launch.active_question_id) return null

  const freshLaunch = db.prepare('SELECT * FROM quiz_launches WHERE id = ?').get(launch.id)
  if (!freshLaunch?.active_question_id) return null

  const question = getQuestionById(freshLaunch.active_question_id)
  if (!question) return null
  const settings = getLaunchSettings(freshLaunch)
  const answers = db.prepare('SELECT * FROM answers WHERE launch_id = ? AND question_id = ?').all(freshLaunch.id, question.id)
  const updateAnswer = db.prepare(`
    UPDATE answers
    SET is_correct = ?, points_awarded = ?
    WHERE id = ?
  `)

  const tx = db.transaction(() => {
    answers.forEach((answer) => {
      const correct = isAnswerCorrect(question, selectedOptionIds(answer))
      const points = calculatePoints(question, correct, answer.response_time_ms, settings.points_mode)
      updateAnswer.run(correct ? 1 : 0, points, answer.id)
    })
    recalculateParticipantStats(freshLaunch.id)
    db.prepare(`
      UPDATE quiz_launches
      SET active_question_id = NULL, question_started_at = NULL, question_expires_at = NULL
      WHERE id = ?
    `).run(freshLaunch.id)
  })
  tx()

  const correctOptionIds = getOptionRows(question.id).filter((option) => asBool(option.is_correct)).map((option) => option.id)
  return {
    question,
    correct_option_ids: correctOptionIds,
    settings,
  }
}

export function startQuestion(launch) {
  const order = getQuestionOrder(launch)
  const nextIndex = launch.current_question_index + 1

  if (nextIndex >= order.length) {
    db.prepare(`
      UPDATE quiz_launches
      SET status = 'finished', active_question_id = NULL, question_started_at = NULL, question_expires_at = NULL, ended_at = ?
      WHERE id = ?
    `).run(nowIso(), launch.id)
    return { finished: true }
  }

  const questionId = order[nextIndex]
  const question = getQuestionById(questionId)
  if (!question) throw new Error('Вопрос не найден')

  const startedAt = Date.now()
  const expiresAt = startedAt + question.time_limit * 1000
  db.prepare(`
    UPDATE quiz_launches
    SET current_question_index = ?, active_question_id = ?, question_started_at = ?, question_expires_at = ?
    WHERE id = ?
  `).run(nextIndex, questionId, startedAt, expiresAt, launch.id)

  const settings = getLaunchSettings(launch)
  return {
    finished: false,
    question: getPublicQuestion(questionId, settings, launch.room_code),
    index: nextIndex,
    total: order.length,
    expires_at: expiresAt / 1000,
  }
}

export function getParticipantForUser(launchId, userId) {
  return db
    .prepare('SELECT * FROM launch_participants WHERE launch_id = ? AND user_id = ?')
    .get(launchId, userId)
}

export function submitAnswer(user, roomCode, optionIds) {
  const launch = getLaunchByRoom(roomCode)
  if (!launch) return { status: 404, detail: 'Комната не найдена' }
  if (launch.status !== 'active') return { status: 400, detail: 'Квиз сейчас не активен' }
  if (!launch.active_question_id) return { status: 400, detail: 'Сейчас нет активного вопроса' }
  if (launch.question_expires_at && Date.now() > launch.question_expires_at) {
    return { status: 400, detail: 'Время ответа на вопрос истекло' }
  }

  const participant = getParticipantForUser(launch.id, user.id)
  if (!participant) return { status: 403, detail: 'Сначала присоединитесь к комнате' }

  const question = getQuestionById(launch.active_question_id)
  if (!question) return { status: 404, detail: 'Вопрос не найден' }

  const validOptionIds = new Set(getOptionRows(question.id).map((option) => option.id))
  const cleaned = [...new Set((Array.isArray(optionIds) ? optionIds : []).map(Number))]
    .filter((id) => Number.isInteger(id) && validOptionIds.has(id))
  if (question.question_type === 'single' && cleaned.length > 1) cleaned.splice(1)
  if (cleaned.length === 0) {
    return { status: 400, detail: 'Выберите хотя бы один вариант ответа' }
  }

  const settings = getLaunchSettings(launch)
  const existing = db
    .prepare('SELECT * FROM answers WHERE launch_id = ? AND participant_id = ? AND question_id = ?')
    .get(launch.id, participant.id, question.id)

  if (existing && !settings.allow_answer_change) {
    return { status: 400, detail: 'Изменение ответа запрещено настройками квиза' }
  }
  if (existing && existing.attempt_count >= settings.max_attempts_per_question) {
    return { status: 400, detail: 'Достигнут лимит попыток для этого вопроса' }
  }

  const responseTimeMs = Math.max(0, Date.now() - Number(launch.question_started_at || Date.now()))
  if (existing) {
    db.prepare(`
      UPDATE answers
      SET selected_option_ids = ?, attempt_count = attempt_count + 1, response_time_ms = ?, answered_at = ?
      WHERE id = ?
    `).run(stringifyJson(cleaned), responseTimeMs, nowIso(), existing.id)
    const answer = db.prepare('SELECT * FROM answers WHERE id = ?').get(existing.id)
    return { status: 200, data: { question_id: question.id, option_ids: cleaned, attempt_count: answer.attempt_count } }
  }

  const info = db.prepare(`
    INSERT INTO answers
      (launch_id, participant_id, question_id, selected_option_ids, response_time_ms, answered_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(launch.id, participant.id, question.id, stringifyJson(cleaned), responseTimeMs, nowIso())
  const answer = db.prepare('SELECT * FROM answers WHERE id = ?').get(info.lastInsertRowid)
  return { status: 201, data: { question_id: question.id, option_ids: cleaned, attempt_count: answer.attempt_count } }
}

function avg(values) {
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function buildQuestionAnalytics(launch, question, displayIndex) {
  const answers = db.prepare('SELECT * FROM answers WHERE launch_id = ? AND question_id = ?').all(launch.id, question.id)
  const totalAnswers = answers.length
  const correctCount = answers.filter((answer) => asBool(answer.is_correct)).length
  const uniqueParticipants = new Set(answers.map((answer) => answer.participant_id)).size
  const responseTimes = answers.map((answer) => answer.response_time_ms).filter((value) => value != null)
  const selectedCounts = new Map()

  answers.forEach((answer) => {
    selectedOptionIds(answer).forEach((optionId) => {
      selectedCounts.set(optionId, (selectedCounts.get(optionId) || 0) + 1)
    })
  })

  const options = getOptionRows(question.id).map((option) => {
    const selectedCount = selectedCounts.get(option.id) || 0
    return {
      option_id: option.id,
      text: option.text,
      selected_count: selectedCount,
      selected_percent: totalAnswers ? Number(((selectedCount / totalAnswers) * 100).toFixed(2)) : 0,
      is_correct: asBool(option.is_correct),
    }
  })

  return {
    question_id: question.id,
    index: displayIndex,
    text: question.text,
    question_type: question.question_type,
    answers_count: totalAnswers,
    unique_participants: uniqueParticipants,
    correct_count: correctCount,
    accuracy_percent: totalAnswers ? Number(((correctCount / totalAnswers) * 100).toFixed(2)) : 0,
    avg_response_time_ms: responseTimes.length ? Number(avg(responseTimes).toFixed(2)) : null,
    options,
  }
}

function getTopWrongOption(questionStat) {
  return questionStat.options
    .filter((option) => !option.is_correct)
    .sort((left, right) => right.selected_count - left.selected_count)[0] || null
}

function buildTeacherInsights(questionStats, participantStats, totalQuestions) {
  const answeredQuestions = questionStats.filter((question) => question.answers_count > 0)
  const needsReview = answeredQuestions
    .filter((question) => question.accuracy_percent < 60)
    .sort((left, right) => left.accuracy_percent - right.accuracy_percent)
    .slice(0, 5)
    .map((question) => {
      const topWrong = getTopWrongOption(question)
      return {
        question_id: question.question_id,
        index: question.index,
        text: question.text,
        accuracy_percent: question.accuracy_percent,
        answers_count: question.answers_count,
        top_wrong_option: topWrong?.selected_count ? topWrong.text : null,
        recommendation: topWrong?.selected_count
          ? `Разобрать путаницу с вариантом «${topWrong.text}»`
          : 'Вернуться к теме и разобрать ход решения',
      }
    })

  const strongQuestions = answeredQuestions
    .filter((question) => question.accuracy_percent >= 80)
    .sort((left, right) => right.accuracy_percent - left.accuracy_percent)
    .slice(0, 3)
    .map((question) => ({
      question_id: question.question_id,
      index: question.index,
      text: question.text,
      accuracy_percent: question.accuracy_percent,
    }))

  const participantRisks = participantStats
    .filter((participant) => (
      participant.answered_count < totalQuestions ||
      (participant.answered_count > 0 && participant.accuracy_percent < 50)
    ))
    .sort((left, right) => left.accuracy_percent - right.accuracy_percent || left.answered_count - right.answered_count)
    .slice(0, 5)
    .map((participant) => ({
      participant_id: participant.participant_id,
      display_name: participant.display_name,
      answered_count: participant.answered_count,
      correct_count: participant.correct_count,
      accuracy_percent: participant.accuracy_percent,
      recommendation: participant.answered_count < totalQuestions
        ? 'Проверить, не теряет ли участник вопросы из-за темпа или подключения'
        : 'Дать дополнительное объяснение по ошибочным темам',
    }))

  const topPerformers = [...participantStats]
    .sort((left, right) => right.total_score - left.total_score || right.correct_count - left.correct_count)
    .slice(0, 3)
    .map((participant) => ({
      participant_id: participant.participant_id,
      display_name: participant.display_name,
      total_score: participant.total_score,
      accuracy_percent: participant.accuracy_percent,
    }))

  const avgQuestionAccuracy = answeredQuestions.length
    ? Number((answeredQuestions.reduce((sum, item) => sum + item.accuracy_percent, 0) / answeredQuestions.length).toFixed(2))
    : 0

  const summary = []
  if (!participantStats.length) {
    summary.push('Участники еще не подключились: можно показывать код комнаты и ждать группу.')
  } else {
    summary.push(`В комнате ${participantStats.length} участник(ов), средняя точность по отвеченным вопросам: ${avgQuestionAccuracy}%.`)
  }
  if (needsReview.length) {
    summary.push(`Для разбора после квиза стоит выделить ${needsReview.length} вопрос(ов) с точностью ниже 60%.`)
  } else if (answeredQuestions.length) {
    summary.push('Критически сложных вопросов не найдено: группа справляется стабильно.')
  }
  if (participantRisks.length) {
    summary.push(`Есть ${participantRisks.length} участник(ов), которым может понадобиться помощь или больше времени.`)
  }

  return {
    summary,
    needs_review: needsReview,
    strong_questions: strongQuestions,
    participant_risks: participantRisks,
    top_performers: topPerformers,
  }
}

export function getLaunchAnalytics(roomCode) {
  const launch = getLaunchByRoom(roomCode)
  if (!launch) return null

  const quiz = getQuizRow(launch.quiz_id)
  const order = getQuestionOrder(launch)
  const questions = order.map(getQuestionById).filter(Boolean)
  const participants = db
    .prepare('SELECT * FROM launch_participants WHERE launch_id = ? ORDER BY total_score DESC, joined_at ASC, id ASC')
    .all(launch.id)

  const answers = db.prepare('SELECT * FROM answers WHERE launch_id = ?').all(launch.id)
  const answersByParticipantQuestion = new Map()
  answers.forEach((answer) => {
    answersByParticipantQuestion.set(`${answer.participant_id}:${answer.question_id}`, answer)
  })

  const questionStats = questions.map((question, index) => buildQuestionAnalytics(launch, question, index))
  const participantStats = participants.map((participant) => {
    let answeredCount = 0
    let correctCount = 0
    const byQuestion = questions.map((question) => {
      const answer = answersByParticipantQuestion.get(`${participant.id}:${question.id}`)
      const answered = Boolean(answer)
      const correct = answer ? asBool(answer.is_correct) : false
      if (answered) answeredCount += 1
      if (correct) correctCount += 1
      return {
        question_id: question.id,
        answered,
        is_correct: correct,
        points_awarded: answer ? answer.points_awarded : 0,
        response_time_ms: answer ? answer.response_time_ms : null,
        selected_option_ids: answer ? selectedOptionIds(answer) : [],
      }
    })

    return {
      participant_id: participant.id,
      display_name: participant.display_name,
      total_score: participant.total_score,
      answered_count: answeredCount,
      correct_count: correctCount,
      accuracy_percent: questions.length ? Number(((correctCount / questions.length) * 100).toFixed(2)) : 0,
      by_question: byQuestion,
    }
  })

  const avgAccuracy = participantStats.length
    ? participantStats.reduce((sum, item) => sum + item.accuracy_percent, 0) / participantStats.length
    : 0

  return {
    room_code: launch.room_code,
    status: launch.status,
    quiz_title: quiz?.title || 'Квиз без названия',
    total_questions: questions.length,
    total_participants: participants.length,
    avg_accuracy_percent: Number(avgAccuracy.toFixed(2)),
    question_stats: questionStats,
    participant_stats: participantStats,
    insights: buildTeacherInsights(questionStats, participantStats, questions.length),
  }
}

function csvCell(value) {
  if (value == null) return ''
  const normalized = String(value).replace(/\r?\n/g, ' ')
  if (/[",;\n]/.test(normalized)) return `"${normalized.replace(/"/g, '""')}"`
  return normalized
}

function csvLine(values) {
  return values.map(csvCell).join(';')
}

export function getLaunchExportCsv(roomCode) {
  const launch = getLaunchByRoom(roomCode)
  if (!launch) return null

  const quiz = getQuizRow(launch.quiz_id)
  const order = getQuestionOrder(launch)
  const questions = order.map(getQuestionById).filter(Boolean)
  const participants = db
    .prepare('SELECT * FROM launch_participants WHERE launch_id = ? ORDER BY total_score DESC, joined_at ASC, id ASC')
    .all(launch.id)
  const answers = db.prepare('SELECT * FROM answers WHERE launch_id = ?').all(launch.id)
  const answersByParticipantQuestion = new Map()
  answers.forEach((answer) => {
    answersByParticipantQuestion.set(`${answer.participant_id}:${answer.question_id}`, answer)
  })

  const header = [
    'Комната',
    'Квиз',
    'Статус',
    'Участник',
    'Место',
    'Итоговые очки',
    'Вопрос №',
    'Вопрос',
    'Тип вопроса',
    'Ответил',
    'Выбранные ответы',
    'Правильные ответы',
    'Верно',
    'Очки за вопрос',
    'Время ответа, мс',
    'Попыток',
  ]

  const lines = [
    `\uFEFF${csvLine(header)}`,
  ]

  participants.forEach((participant, participantIndex) => {
    questions.forEach((question, questionIndex) => {
      const options = getOptionRows(question.id)
      const answer = answersByParticipantQuestion.get(`${participant.id}:${question.id}`)
      const selectedIds = answer ? new Set(selectedOptionIds(answer)) : new Set()
      const selectedTexts = options.filter((option) => selectedIds.has(option.id)).map((option) => option.text).join(', ')
      const correctTexts = options.filter((option) => asBool(option.is_correct)).map((option) => option.text).join(', ')
      lines.push(csvLine([
        launch.room_code,
        quiz?.title || 'Квиз без названия',
        launch.status,
        participant.display_name,
        participantIndex + 1,
        participant.total_score,
        questionIndex + 1,
        question.text,
        question.question_type === 'multiple' ? 'Множественный выбор' : 'Одиночный выбор',
        answer ? 'Да' : 'Нет',
        selectedTexts,
        correctTexts,
        answer ? (asBool(answer.is_correct) ? 'Да' : 'Нет') : 'Нет ответа',
        answer ? answer.points_awarded : 0,
        answer?.response_time_ms ?? '',
        answer?.attempt_count ?? '',
      ]))
    })
  })

  if (!participants.length) {
    lines.push(csvLine([
      launch.room_code,
      quiz?.title || 'Квиз без названия',
      launch.status,
      'Нет участников',
      '',
      '',
      '',
      '',
      '',
      'Нет',
      '',
      '',
      '',
      '',
      '',
      '',
    ]))
  }

  return lines.join('\n')
}

export function getHistory(user) {
  if (user.role === 'organizer') {
    const rows = db.prepare(`
      SELECT l.*, q.title AS quiz_title
      FROM quiz_launches l
      JOIN quizzes q ON q.id = l.quiz_id
      WHERE l.organizer_id = ?
      ORDER BY l.id DESC
    `).all(user.id)

    return rows.map((row) => ({
      launch_id: row.id,
      room_code: row.room_code,
      quiz_title: row.quiz_title,
      role: 'organizer',
      status: row.status,
      started_at: row.started_at,
      ended_at: row.ended_at,
      score: null,
    }))
  }

  const rows = db.prepare(`
    SELECT p.total_score, l.*, q.title AS quiz_title
    FROM launch_participants p
    JOIN quiz_launches l ON l.id = p.launch_id
    JOIN quizzes q ON q.id = l.quiz_id
    WHERE p.user_id = ?
    ORDER BY p.id DESC
  `).all(user.id)

  return rows.map((row) => ({
    launch_id: row.id,
    room_code: row.room_code,
    quiz_title: row.quiz_title,
    role: 'participant',
    status: row.status,
    started_at: row.started_at,
    ended_at: row.ended_at,
    score: row.total_score,
  }))
}
