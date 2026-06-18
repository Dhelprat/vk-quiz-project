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
const currentQuestion = ref(null)
const currentQuestionIndex = ref(-1)
const questionTotal = ref(0)
const selectedOptionIds = ref([])
const leaderboard = ref([])
const participants = ref([])
const answerProgress = ref(null)
const settings = ref(null)
const message = ref('')
const error = ref('')
const expiresAt = ref(null)
const countdown = ref(null)
const submittedAttempts = ref(0)
const timerTick = ref(Date.now())
let timerInterval = null

const { isConnected, connect, close, send } = useRoomSocket({
  apiBase: api.base,
  roomCode: roomCode.value,
  token: auth.token,
  onMessage: (payload) => {
    if (payload.type === 'connected') {
      status.value = payload.status
      questionTotal.value = payload.question_total
      currentQuestionIndex.value = payload.current_question_index
      leaderboard.value = payload.leaderboard || []
      participants.value = payload.participants || []
      answerProgress.value = payload.answer_progress || null
      settings.value = payload.settings || null
    }

    if (payload.type === 'launch_status') {
      status.value = payload.status
    }

    if (payload.type === 'question_started') {
      status.value = 'active'
      currentQuestion.value = payload.question
      currentQuestionIndex.value = payload.index
      questionTotal.value = payload.total
      selectedOptionIds.value = []
      message.value = ''
      error.value = ''
      expiresAt.value = payload.expires_at
      answerProgress.value = payload.answer_progress || null
      countdown.value = null
      submittedAttempts.value = 0
    }

    if (payload.type === 'answer_received') {
      submittedAttempts.value = payload.attempt_count || submittedAttempts.value + 1
      error.value = ''
      const attemptPart = payload.attempt_count ? ` (попытка ${payload.attempt_count})` : ''
      message.value = `Ответ принят${attemptPart}`
    }

    if (payload.type === 'question_finished') {
      if (payload.correct_option_ids?.length && currentQuestion.value) {
        const correctText = currentQuestion.value.options
          .filter((option) => payload.correct_option_ids.includes(option.id))
          .map((option) => option.text)
          .join(', ')

        message.value = correctText
          ? `Вопрос завершен. Правильный ответ: ${correctText}`
          : 'Вопрос завершен. Ждём следующий.'
      } else {
        message.value = 'Вопрос завершен. Ждём следующий.'
      }
      currentQuestion.value = null
      selectedOptionIds.value = []
      expiresAt.value = null
      answerProgress.value = null
      submittedAttempts.value = 0
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
      message.value = 'Квиз завершён'
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
      selectedOptionIds.value = []
      expiresAt.value = null
      status.value = 'active'
      message.value = ''
      error.value = ''
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
    questionTotal.value = state.question_total
    currentQuestionIndex.value = state.current_question_index
    leaderboard.value = state.leaderboard || []
    participants.value = state.participants || []
    answerProgress.value = state.answer_progress || null
    settings.value = state.settings || null
  } catch (err) {
    error.value = err.message || 'Не удалось загрузить состояние'
  }
}

function toggleOption(optionId) {
  if (!currentQuestion.value) return

  if (currentQuestion.value.question_type === 'single') {
    selectedOptionIds.value = [optionId]
    return
  }

  if (selectedOptionIds.value.includes(optionId)) {
    selectedOptionIds.value = selectedOptionIds.value.filter((id) => id !== optionId)
  } else {
    selectedOptionIds.value = [...selectedOptionIds.value, optionId]
  }
}

function submitAnswer() {
  if (!currentQuestion.value || !canSubmit.value) return
  error.value = ''
  send({
    type: 'submit_answer',
    option_ids: selectedOptionIds.value,
})
}

function statusLabel(value) {
  if (value === 'waiting') return 'Ожидание'
  if (value === 'active') return 'Активен'
  if (value === 'finished') return 'Завершен'
  return value
}

const maxAttempts = computed(() => Number(settings.value?.max_attempts_per_question || 1))
const canChangeAnswer = computed(() => Boolean(settings.value?.allow_answer_change))
const canSubmit = computed(() => {
  if (!currentQuestion.value || selectedOptionIds.value.length === 0) return false
  if (submittedAttempts.value === 0) return true
  return canChangeAnswer.value && submittedAttempts.value < maxAttempts.value
})

const submitButtonText = computed(() => {
  if (submittedAttempts.value === 0) return 'Отправить ответ'
  if (canSubmit.value) return 'Обновить ответ'
  return 'Ответ уже принят'
})

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

onMounted(async () => {
  timerInterval = window.setInterval(() => {
    timerTick.value = Date.now()
  }, 1000)
  await loadState()
  connect()
})

onUnmounted(() => {
  if (timerInterval) window.clearInterval(timerInterval)
  close()
})
</script>

<template>
  <section class="live-page player">
    <div class="container live-grid">
      <div class="card live-main">
        <div class="live-head">
          <div>
            <h1>Комната участника</h1>
            <p>Комната: <strong>{{ roomCode }}</strong></p>
          </div>
          <span class="pill">Связь: {{ isConnected ? 'подключена' : 'нет соединения' }}</span>
        </div>

        <p class="subtext">
          Статус: <strong>{{ statusLabel(status) }}</strong>
          · Вопрос: <strong>{{ Math.max(0, currentQuestionIndex + 1) }}/{{ questionTotal }}</strong>
          · Таймер: <strong>{{ timerText }}</strong>
          · В комнате: <strong>{{ participants.length }}</strong>
        </p>
        <div class="progress-track calm" aria-hidden="true">
          <span :style="{ width: `${questionProgressPercent}%` }" />
        </div>

        <p v-if="error" class="error-text">{{ error }}</p>
        <p v-if="message" class="success-text">{{ message }}</p>

        <div v-if="countdown" class="card countdown-card">
          <span class="row-kicker">Countdown</span>
          <h2>Следующий вопрос через {{ countdownText }}</h2>
          <p>Приготовьтесь: вопрос откроется одновременно для всех участников.</p>
        </div>

        <div v-if="status === 'waiting'" class="card lobby-card">
          <div class="section-head">
            <div>
              <span class="row-kicker">Lobby</span>
              <h2>Вы в комнате ожидания</h2>
            </div>
            <strong>{{ participants.length }}</strong>
          </div>
          <p class="muted">Организатор скоро запустит квиз. Пока можно проверить имя и соединение.</p>
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
              <h2>Игроки отвечают</h2>
            </div>
            <strong>{{ answerProgress.answered_count }}/{{ answerProgress.total_participants }}</strong>
          </div>
          <p>
            Ответили: <strong>{{ answerProgress.answered_count }}</strong>
            · Еще отвечают: <strong>{{ answerProgress.pending_count }}</strong>
          </p>
          <div class="progress-track calm" aria-hidden="true">
            <span :style="{ width: `${answerProgressPercent}%` }" />
          </div>
        </div>

        <div v-if="currentQuestion" class="card">
          <h2>{{ currentQuestion.text }}</h2>
          <img v-if="currentQuestion.image_url" :src="currentQuestion.image_url" alt="question" class="question-image" />

          <div class="option-buttons">
            <button
              v-for="option in currentQuestion.options"
              :key="option.id"
              class="option-btn"
              :class="{ active: selectedOptionIds.includes(option.id) }"
              @click="toggleOption(option.id)"
            >
              {{ option.text }}
            </button>
          </div>

          <button class="btn primary" :disabled="!canSubmit" @click="submitAnswer">{{ submitButtonText }}</button>
        </div>

        <div v-else-if="!countdown && status !== 'waiting'" class="card muted">Ожидание следующего вопроса от организатора.</div>
      </div>

      <aside
        v-if="status === 'finished' || settings?.show_leaderboard_after_each_question"
        class="card live-aside"
      >
        <p class="eyebrow">Prize places</p>
        <h2>Лидерборд</h2>
        <div v-if="leaderboard.length === 0" class="muted">Рейтинг пока пуст.</div>
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
