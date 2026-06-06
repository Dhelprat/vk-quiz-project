<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { useRoomSocket } from '../composables/useRoomSocket'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const auth = useAuthStore()

const roomCode = computed(() => String(route.params.roomCode || '').toUpperCase())

const status = ref('waiting')
const currentQuestionIndex = ref(-1)
const questionTotal = ref(0)
const currentQuestion = ref(null)
const leaderboard = ref([])
const participants = ref([])
const answerProgress = ref(null)
const settings = ref(null)
const analytics = ref(null)
const expiresAt = ref(null)
const countdown = ref(null)
const error = ref('')
const copied = ref(false)
const viewMode = ref('control')
const exporting = ref(false)
const timerTick = ref(Date.now())
let timerInterval = null

const { isConnected, connect, close, send } = useRoomSocket({
  apiBase: api.base,
  roomCode: roomCode.value,
  token: auth.token,
  onMessage: (payload) => {
    if (payload.type === 'connected') {
      status.value = payload.status
      currentQuestionIndex.value = payload.current_question_index
      questionTotal.value = payload.question_total
      leaderboard.value = payload.leaderboard || []
      participants.value = payload.participants || []
      answerProgress.value = payload.answer_progress || null
      settings.value = payload.settings || null
    }

    if (payload.type === 'launch_status') {
      status.value = payload.status
    }

    if (payload.type === 'question_started') {
      currentQuestion.value = payload.question
      currentQuestionIndex.value = payload.index
      questionTotal.value = payload.total
      expiresAt.value = payload.expires_at
      answerProgress.value = payload.answer_progress || null
      countdown.value = null
      status.value = 'active'
    }

    if (payload.type === 'question_finished') {
      currentQuestion.value = null
      expiresAt.value = null
      answerProgress.value = null
    }

    if (payload.type === 'leaderboard') {
      leaderboard.value = payload.items || []
    }

    if (payload.type === 'launch_finished') {
      status.value = 'finished'
      currentQuestion.value = null
      expiresAt.value = null
      countdown.value = null
      answerProgress.value = null
      leaderboard.value = payload.leaderboard || []
    }

    if (payload.type === 'analytics_snapshot') {
      analytics.value = payload.data
    }

    if (payload.type === 'lobby_state') {
      participants.value = payload.participants || []
    }

    if (payload.type === 'answer_progress') {
      answerProgress.value = payload.progress || null
    }

    if (payload.type === 'countdown_started') {
      countdown.value = {
        seconds: Number(payload.seconds || 0),
        remainingSeconds: Number(payload.remaining_seconds ?? payload.seconds ?? 0),
        startsAt: Number(payload.starts_at || Date.now() / 1000),
        deadlineAt: Date.now() / 1000 + Number(payload.remaining_seconds ?? payload.seconds ?? 0),
        nextQuestionIndex: Number(payload.next_question_index ?? currentQuestionIndex.value + 1),
        total: Number(payload.total || questionTotal.value),
      }
      currentQuestion.value = null
      expiresAt.value = null
      status.value = 'active'
    }

    if (payload.type === 'question_analytics' && analytics.value) {
      const item = payload.question
      const exists = analytics.value.question_stats.findIndex((row) => row.question_id === item.question_id)
      if (exists >= 0) {
        analytics.value.question_stats[exists] = item
      } else {
        analytics.value.question_stats.push(item)
      }
    }

    if (payload.type === 'error') {
      error.value = payload.message || 'Ошибка сокета'
    }
  },
})

async function loadState() {
  try {
    const state = await api.request(`/api/sessions/${roomCode.value}`, {
      headers: api.authHeader(auth.token),
    })
    status.value = state.status
    currentQuestionIndex.value = state.current_question_index
    questionTotal.value = state.question_total
    leaderboard.value = state.leaderboard || []
    participants.value = state.participants || []
    answerProgress.value = state.answer_progress || null
    settings.value = state.settings || null
  } catch (err) {
    error.value = err.message || 'Не удалось загрузить состояние комнаты'
  }
}

async function loadAnalytics() {
  try {
    analytics.value = await api.request(`/api/sessions/${roomCode.value}/analytics`, {
      headers: api.authHeader(auth.token),
    })
  } catch (err) {
    error.value = err.message || 'Не удалось загрузить аналитику'
  }
}

function startQuiz() {
  error.value = ''
  send({ type: 'start' })
}

function nextQuestion() {
  error.value = ''
  send({ type: 'next' })
}

function finishQuiz() {
  error.value = ''
  send({ type: 'finish' })
}

function refreshAnalyticsViaWs() {
  send({ type: 'request_analytics' })
}

async function exportResults() {
  exporting.value = true
  error.value = ''
  try {
    const response = await fetch(`${api.base}/api/sessions/${roomCode.value}/export.csv`, {
      headers: api.authHeader(auth.token),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new Error(payload?.detail || 'Не удалось скачать результаты')
    }
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `quizhub-${roomCode.value}-results.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  } catch (err) {
    error.value = err.message || 'Не удалось скачать результаты'
  } finally {
    exporting.value = false
  }
}

function questionProgressText(row) {
  if (!row?.by_question?.length) return '—'
  return row.by_question
    .map((item, idx) => {
      if (!item.answered) return `Q${idx + 1}:—`
      const mark = item.is_correct ? '✓' : '✗'
      return `Q${idx + 1}:${mark}(${item.points_awarded})`
    })
    .join(' · ')
}

function statusLabel(value) {
  if (value === 'waiting') return 'Ожидание'
  if (value === 'active') return 'Активен'
  if (value === 'finished') return 'Завершен'
  return value
}

function pointsModeLabel(value) {
  if (value === 'speed') return 'Точность и скорость'
  if (value === 'accuracy') return 'Только точность'
  if (value === 'disabled') return 'Без очков'
  return value
}

async function copyRoomCode() {
  await navigator.clipboard.writeText(roomCode.value)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 1200)
}

const timerText = computed(() => {
  timerTick.value
  if (!expiresAt.value) return '—'
  const left = Math.max(0, Math.ceil(expiresAt.value - Date.now() / 1000))
  return `${left} c`
})

const countdownText = computed(() => {
  timerTick.value
  if (!countdown.value) return ''
  const left = Math.max(0, Math.ceil(countdown.value.deadlineAt - Date.now() / 1000))
  return `${left} c`
})

const questionProgressPercent = computed(() => {
  if (!questionTotal.value) return 0
  return Math.min(100, Math.max(0, ((currentQuestionIndex.value + 1) / questionTotal.value) * 100))
})

const answerProgressPercent = computed(() => {
  const total = answerProgress.value?.total_participants || participants.value.length
  if (!total) return 0
  return Math.min(100, Math.max(0, ((answerProgress.value?.answered_count || 0) / total) * 100))
})

const participantSummary = computed(() => {
  const total = participants.value.length
  if (!total) return 'Участники еще не подключились'
  return `${total} участник(ов) в комнате`
})

function percent(value) {
  const normalized = Number(value || 0)
  return `${Math.min(100, Math.max(0, normalized))}%`
}

function formatMs(value) {
  if (value == null) return '—'
  if (value < 1000) return `${Math.round(value)} миллисек.`
  return `${(value / 1000).toFixed(1)} с`
}

const analyticsKpis = computed(() => {
  if (!analytics.value) return []
  const totalQuestionAnswers = analytics.value.participant_stats.reduce((sum, item) => sum + item.answered_count, 0)
  const possibleAnswers = Math.max(1, analytics.value.total_participants * analytics.value.total_questions)
  const completionRate = Number(((totalQuestionAnswers / possibleAnswers) * 100).toFixed(1))
  const responseTimes = analytics.value.question_stats
    .map((question) => question.avg_response_time_ms)
    .filter((value) => value != null)
  const avgResponseTime = responseTimes.length
    ? responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length
    : null

  return [
    { label: 'Участников', value: analytics.value.total_participants, hint: 'подключились к комнате' },
    { label: 'Средняя точность', value: `${analytics.value.avg_accuracy_percent}%`, hint: 'по всем участникам' },
    { label: 'Завершенность', value: `${completionRate}%`, hint: 'ответов от возможных' },
    { label: 'Средний темп', value: formatMs(avgResponseTime), hint: 'по отвеченным вопросам' },
  ]
})

const questionChartRows = computed(() => {
  if (!analytics.value) return []
  return analytics.value.question_stats.map((question) => {
    const topWrongOption = question.options
      .filter((option) => !option.is_correct)
      .sort((left, right) => right.selected_count - left.selected_count)[0]
    return {
      ...question,
      completion_percent: analytics.value.total_participants
        ? Number(((question.unique_participants / analytics.value.total_participants) * 100).toFixed(1))
        : 0,
      top_wrong_text: topWrongOption?.selected_count ? topWrongOption.text : 'нет выраженной ошибки',
    }
  })
})

const participantChartRows = computed(() => {
  if (!analytics.value) return []
  const maxScore = Math.max(1, ...analytics.value.participant_stats.map((item) => item.total_score))
  return analytics.value.participant_stats.map((participant) => ({
    ...participant,
    score_percent: Number(((participant.total_score / maxScore) * 100).toFixed(1)),
    completion_percent: analytics.value.total_questions
      ? Number(((participant.answered_count / analytics.value.total_questions) * 100).toFixed(1))
      : 0,
  }))
})

const analyticsConclusion = computed(() => {
  if (!analytics.value) return []
  const rows = []
  const hardest = [...questionChartRows.value]
    .filter((question) => question.answers_count > 0)
    .sort((left, right) => left.accuracy_percent - right.accuracy_percent)[0]
  const completion = analyticsKpis.value.find((item) => item.label === 'Завершенность')?.value || '0%'

  if (hardest) {
    rows.push(`Самый сложный вопрос: Q${hardest.index + 1}, точность ${hardest.accuracy_percent}%.`)
  }
  rows.push(`Завершенность прохождения: ${completion}.`)
  if (analytics.value.avg_accuracy_percent >= 80) {
    rows.push('Группа уверенно справилась с квизом, можно переходить к следующему блоку материала.')
  } else if (analytics.value.avg_accuracy_percent >= 50) {
    rows.push('Результат средний: стоит коротко разобрать вопросы с низкой точностью.')
  } else {
    rows.push('Результат низкий: материал лучше повторить до следующего квиза.')
  }
  return rows
})

onMounted(async () => {
  timerInterval = window.setInterval(() => {
    timerTick.value = Date.now()
  }, 1000)
  await Promise.all([loadState(), loadAnalytics()])
  connect()
})

onUnmounted(() => {
  if (timerInterval) window.clearInterval(timerInterval)
  close()
})
</script>

<template>
  <section class="live-page">
    <div class="container live-grid">
      <div class="card live-main">
        <div class="live-head">
          <div>
            <h1>Панель ведущего</h1>
            <p>Комната: <strong>{{ roomCode }}</strong></p>
          </div>
          <div class="live-head-actions">
            <button class="btn ghost" @click="copyRoomCode">
              {{ copied ? 'Скопировано' : 'Скопировать код' }}
            </button>
            <span class="pill">Связь: {{ isConnected ? 'подключена' : 'нет соединения' }}</span>
          </div>
        </div>

        <div class="host-controls primary-controls">
          <button class="btn primary" :disabled="status !== 'waiting'" @click="startQuiz">Начать</button>
          <button class="btn ghost" :disabled="status !== 'active'" @click="nextQuestion">Следующий вопрос</button>
          <button class="btn danger" :disabled="status === 'waiting' || status === 'finished'" @click="finishQuiz">Завершить</button>
          <button class="btn ghost" @click="refreshAnalyticsViaWs">Обновить аналитику</button>
          <button
            class="btn ghost icon-btn export-btn"
            :disabled="exporting"
            :title="exporting ? 'Готовим CSV...' : 'Экспорт результатов'"
            :aria-label="exporting ? 'Готовим CSV' : 'Экспорт результатов'"
            @click="exportResults"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3v10m0 0 4-4m-4 4-4-4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
            </svg>
          </button>
        </div>

        <div class="host-controls view-controls">
          <button class="btn ghost" :class="{ 'tab-active': viewMode === 'control' }" @click="viewMode = 'control'">
            Live режим
          </button>
          <button class="btn ghost" :class="{ 'tab-active': viewMode === 'analytics' }" @click="viewMode = 'analytics'">
            Режим администратора
          </button>
        </div>

        <p class="subtext live-status">
          Статус: <strong>{{ statusLabel(status) }}</strong>
          · Вопрос: <strong>{{ Math.max(0, currentQuestionIndex + 1) }}/{{ questionTotal }}</strong>
          · Таймер: <strong>{{ timerText }}</strong>
          · {{ participantSummary }}
        </p>
        <div class="progress-track" aria-hidden="true">
          <span :style="{ width: `${questionProgressPercent}%` }" />
        </div>

        <p v-if="error" class="error-text">{{ error }}</p>

        <template v-if="viewMode === 'control'">
          <div v-if="countdown" class="card countdown-card">
            <span class="row-kicker">Countdown</span>
            <h2>Вопрос {{ countdown.nextQuestionIndex + 1 }} начнется через {{ countdownText }}</h2>
            <p>Участники видят этот же обратный отсчет и готовятся отвечать одновременно.</p>
          </div>

          <div v-if="status === 'waiting'" class="card lobby-card">
            <div class="section-head">
              <div>
                <span class="row-kicker">Lobby</span>
                <h2>Экран ожидания участников</h2>
              </div>
              <strong>{{ participants.length }}</strong>
            </div>
            <p class="muted">Покажите код комнаты на экране и запускайте квиз, когда группа будет готова.</p>
            <div v-if="participants.length" class="participant-chips">
              <span v-for="participant in participants" :key="participant.participant_id">
                {{ participant.display_name }}
              </span>
            </div>
          </div>

          <div v-if="currentQuestion && answerProgress" class="card answer-progress-card">
            <div class="section-head">
              <div>
                <span class="row-kicker">Answers</span>
                <h2>Прогресс ответов</h2>
              </div>
              <strong>{{ answerProgress.answered_count }}/{{ answerProgress.total_participants }}</strong>
            </div>
            <p>
              Ответили: <strong>{{ answerProgress.answered_count }}</strong>
              · Еще не ответили: <strong>{{ answerProgress.pending_count }}</strong>
            </p>
            <div class="progress-track calm" aria-hidden="true">
              <span :style="{ width: `${answerProgressPercent}%` }" />
            </div>
          </div>

          <div v-if="currentQuestion" class="question-live card">
            <h2>{{ currentQuestion.text }}</h2>
            <img v-if="currentQuestion.image_url" :src="currentQuestion.image_url" alt="question" class="question-image" />
            <ul class="option-preview">
              <li v-for="option in currentQuestion.options" :key="option.id">{{ option.text }}</li>
            </ul>
          </div>

          <div v-else-if="!countdown && status !== 'waiting'" class="card muted">
            Текущий вопрос не отображается. Нажмите «Начать» или «Следующий вопрос».
          </div>

          <div v-if="settings" class="card">
            <h2>Настройки запущенного квиза</h2>
            <div class="stats-grid">
              <p><strong>Модель очков:</strong> {{ pointsModeLabel(settings.points_mode) }}</p>
              <p><strong>Перемешивание вопросов:</strong> {{ settings.randomize_question_order ? 'Да' : 'Нет' }}</p>
              <p><strong>Перемешивание ответов:</strong> {{ settings.randomize_answer_order ? 'Да' : 'Нет' }}</p>
              <p><strong>Поздний вход:</strong> {{ settings.allow_late_join ? 'Разрешен' : 'Запрещен' }}</p>
              <p><strong>Изменение ответа:</strong> {{ settings.allow_answer_change ? 'Да' : 'Нет' }}</p>
              <p><strong>Попыток на вопрос:</strong> {{ settings.max_attempts_per_question }}</p>
              <p><strong>Обратный отсчет:</strong> {{ settings.countdown_seconds }} сек</p>
            </div>
          </div>
        </template>

        <template v-else>
          <div v-if="analytics" class="card analytics-dashboard">
            <h2>Сводка по сессии</h2>
            <p class="analytics-subtitle">{{ analytics.quiz_title }}</p>

            <div class="kpi-grid">
              <article v-for="item in analyticsKpis" :key="item.label" class="kpi-card">
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
                <small>{{ item.hint }}</small>
              </article>
            </div>

            <div class="analytics-conclusion">
              <p v-for="line in analyticsConclusion" :key="line">{{ line }}</p>
            </div>
          </div>

          <div v-if="analytics" class="card chart-panel">
            <div class="chart-head">
              <div>
                <h2>График точности по вопросам</h2>
                <p>Показывает, какие задания были простыми, а какие требуют разбора.</p>
              </div>
            </div>

            <div class="question-bars">
              <article v-for="question in questionChartRows" :key="question.question_id" class="question-bar">
                <div class="bar-title">
                  <strong>Q{{ question.index + 1 }}</strong>
                  <span>{{ question.text }}</span>
                  <em>{{ question.accuracy_percent }}%</em>
                </div>
                <div class="metric-bar" aria-hidden="true">
                  <span :style="{ width: percent(question.accuracy_percent) }" />
                </div>
                <div class="bar-meta">
                  <span>Ответили: {{ question.unique_participants }}/{{ analytics.total_participants }}</span>
                  <span>Среднее время: {{ formatMs(question.avg_response_time_ms) }}</span>
                  <span>Частая ошибка: {{ question.top_wrong_text }}</span>
                </div>
              </article>
            </div>
          </div>

          <div v-if="analytics" class="card chart-panel">
            <h2>Распределение ответов</h2>
            <div class="option-distribution">
              <article v-for="question in questionChartRows" :key="`dist-${question.question_id}`" class="distribution-card">
                <h3>Q{{ question.index + 1 }}</h3>
                <div v-for="option in question.options" :key="option.option_id" class="option-stat">
                  <div>
                    <span>{{ option.text }}</span>
                    <strong>{{ option.selected_count }} · {{ option.selected_percent }}%</strong>
                  </div>
                  <div class="metric-bar small" :class="{ correct: option.is_correct }" aria-hidden="true">
                    <span :style="{ width: percent(option.selected_percent) }" />
                  </div>
                </div>
              </article>
            </div>
          </div>

          <div v-if="analytics" class="card chart-panel">
            <h2>Прогресс участников</h2>
            <div class="participant-bars">
              <article v-for="participant in participantChartRows" :key="participant.participant_id" class="participant-bar">
                <div class="bar-title">
                  <strong>{{ participant.display_name }}</strong>
                  <span>{{ participant.correct_count }}/{{ analytics.total_questions }} верно</span>
                  <em>{{ participant.total_score }} очков</em>
                </div>
                <div class="dual-bars">
                  <div>
                    <small>Очки</small>
                    <div class="metric-bar" aria-hidden="true">
                      <span :style="{ width: percent(participant.score_percent) }" />
                    </div>
                  </div>
                  <div>
                    <small>Точность</small>
                    <div class="metric-bar calm" aria-hidden="true">
                      <span :style="{ width: percent(participant.accuracy_percent) }" />
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </div>

          <div v-if="analytics" class="card">
            <h2>Успехи участников</h2>
            <div class="table-wrap">
              <table class="stat-table">
                <thead>
                  <tr>
                    <th>Участник</th>
                    <th>Очки</th>
                    <th>Отвечено</th>
                    <th>Верно</th>
                    <th>Точность</th>
                    <th>Детализация</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in analytics.participant_stats" :key="row.participant_id">
                    <td>{{ row.display_name }}</td>
                    <td>{{ row.total_score }}</td>
                    <td>{{ row.answered_count }}</td>
                    <td>{{ row.correct_count }}</td>
                    <td>{{ row.accuracy_percent }}%</td>
                    <td>{{ questionProgressText(row) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </div>

      <aside class="card live-aside">
        <p class="eyebrow">Prize places</p>
        <h2>Лидерборд</h2>
        <div v-if="leaderboard.length === 0" class="muted">Пока нет результатов.</div>
        <ol v-else class="leader-list">
          <li v-for="item in leaderboard" :key="item.participant_id">
            <span>{{ item.display_name }}</span>
            <strong>{{ item.total_score }}</strong>
          </li>
        </ol>
      </aside>
    </div>
  </section>
</template>
