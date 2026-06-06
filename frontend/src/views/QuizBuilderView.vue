<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const quizMeta = reactive({
  title: '',
  description: '',
  category: 'General',
  default_time_limit: 20,
  rules: '',
  settings: {
    randomize_question_order: false,
    randomize_answer_order: false,
    show_leaderboard_after_each_question: true,
    show_correct_answers_after_question: true,
    allow_late_join: true,
    allow_answer_change: true,
    max_attempts_per_question: 1,
    points_mode: 'speed',
    countdown_seconds: 0,
  },
})

const questions = ref([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')

const resolvedQuizId = computed(() => {
  const raw = route.params.quizId
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
})

const isEdit = computed(() => Boolean(resolvedQuizId.value))

function createOption() {
  return { text: '', is_correct: false }
}

function createQuestion() {
  return {
    text: '',
    image_url: '',
    question_type: 'single',
    points: 100,
    time_limit: 20,
    options: [createOption(), createOption()],
  }
}

function addQuestion() {
  if (questions.value.length >= 50) {
    error.value = 'В MVP можно добавить не более 50 вопросов'
    return
  }
  questions.value.push(createQuestion())
}

function removeQuestion(index) {
  questions.value.splice(index, 1)
}

function addOption(question) {
  if (question.options.length >= 8) {
    error.value = 'В вопросе может быть не более 8 вариантов ответа'
    return
  }
  question.options.push(createOption())
}

function removeOption(question, optionIndex) {
  if (question.options.length <= 2) return
  question.options.splice(optionIndex, 1)
}

function setOptionCorrect(question, optionIndex, checked) {
  if (question.question_type === 'single' && checked) {
    question.options.forEach((opt, idx) => {
      opt.is_correct = idx === optionIndex
    })
    return
  }

  question.options[optionIndex].is_correct = checked
}

function normalizeQuestionType(question) {
  if (question.question_type !== 'single') return
  const firstCorrectIndex = question.options.findIndex((option) => option.is_correct)
  question.options.forEach((option, index) => {
    option.is_correct = firstCorrectIndex >= 0 && index === firstCorrectIndex
  })
}

function validate() {
  if (!quizMeta.title.trim()) return 'Укажите название квиза'
  if (questions.value.length === 0) return 'Добавьте хотя бы один вопрос'
  if (questions.value.length > 50) return 'В MVP можно добавить не более 50 вопросов'

  for (let i = 0; i < questions.value.length; i += 1) {
    const question = questions.value[i]
    if (!question.text.trim()) return `Вопрос ${i + 1}: заполните текст`
    if (question.options.length < 2 || question.options.length > 8) return `Вопрос ${i + 1}: должно быть от 2 до 8 вариантов`
    if (question.options.some((option) => !option.text.trim())) return `Вопрос ${i + 1}: заполните все варианты`
    const correctCount = question.options.filter((option) => option.is_correct).length
    if (correctCount === 0) return `Вопрос ${i + 1}: отметьте хотя бы один правильный ответ`
    if (question.question_type === 'single' && correctCount !== 1) {
      return `Вопрос ${i + 1}: для одиночного выбора должен быть ровно один правильный ответ`
    }
    if (Number(question.points) < 1 || Number(question.points) > 1000) return `Вопрос ${i + 1}: баллы должны быть от 1 до 1000`
    if (Number(question.time_limit) < 5 || Number(question.time_limit) > 180) return `Вопрос ${i + 1}: таймер должен быть от 5 до 180 секунд`
  }

  return ''
}

async function loadQuiz(quizId) {
  loading.value = true
  error.value = ''

  try {
    const quiz = await api.request(`/api/quizzes/${quizId}`, {
      headers: api.authHeader(auth.token),
    })

    quizMeta.title = quiz.title
    quizMeta.description = quiz.description
    quizMeta.category = quiz.category
    quizMeta.default_time_limit = quiz.default_time_limit
    quizMeta.rules = quiz.rules
    quizMeta.settings = {
      randomize_question_order: Boolean(quiz.settings?.randomize_question_order),
      randomize_answer_order: Boolean(quiz.settings?.randomize_answer_order),
      show_leaderboard_after_each_question: Boolean(quiz.settings?.show_leaderboard_after_each_question ?? true),
      show_correct_answers_after_question: Boolean(quiz.settings?.show_correct_answers_after_question ?? true),
      allow_late_join: Boolean(quiz.settings?.allow_late_join ?? true),
      allow_answer_change: Boolean(quiz.settings?.allow_answer_change ?? true),
      max_attempts_per_question: Number(quiz.settings?.max_attempts_per_question ?? 1),
      points_mode: quiz.settings?.points_mode || 'speed',
      countdown_seconds: Number(quiz.settings?.countdown_seconds ?? 0),
    }

    questions.value = quiz.questions.map((question) => ({
      text: question.text,
      image_url: question.image_url || '',
      question_type: question.question_type,
      points: question.points,
      time_limit: question.time_limit,
      options: question.options.map((option) => ({
        text: option.text,
        is_correct: option.is_correct,
      })),
    }))
  } catch (err) {
    error.value = err.message || 'Не удалось загрузить квиз'
  } finally {
    loading.value = false
  }
}

async function saveQuiz() {
  const validationError = validate()
  error.value = validationError
  notice.value = ''
  if (validationError) return

  saving.value = true

  try {
    const quizPayload = {
      title: quizMeta.title,
      description: quizMeta.description,
      category: quizMeta.category,
      default_time_limit: Number(quizMeta.default_time_limit),
      rules: quizMeta.rules,
      settings: {
        randomize_question_order: Boolean(quizMeta.settings.randomize_question_order),
        randomize_answer_order: Boolean(quizMeta.settings.randomize_answer_order),
        show_leaderboard_after_each_question: Boolean(quizMeta.settings.show_leaderboard_after_each_question),
        show_correct_answers_after_question: Boolean(quizMeta.settings.show_correct_answers_after_question),
        allow_late_join: Boolean(quizMeta.settings.allow_late_join),
        allow_answer_change: Boolean(quizMeta.settings.allow_answer_change),
        max_attempts_per_question: Number(quizMeta.settings.max_attempts_per_question),
        points_mode: quizMeta.settings.points_mode,
        countdown_seconds: Number(quizMeta.settings.countdown_seconds),
      },
    }

    let quizId = resolvedQuizId.value

    if (!isEdit.value) {
      const created = await api.request('/api/quizzes', {
        method: 'POST',
        headers: api.authHeader(auth.token),
        body: quizPayload,
      })
      quizId = created.id
    } else {
      await api.request(`/api/quizzes/${quizId}`, {
        method: 'PUT',
        headers: api.authHeader(auth.token),
        body: quizPayload,
      })
    }

    await api.request(`/api/quizzes/${quizId}/questions`, {
      method: 'POST',
      headers: api.authHeader(auth.token),
      body: {
        questions: questions.value.map((question) => ({
          ...question,
          image_url: question.image_url || null,
          points: Number(question.points),
          time_limit: Number(question.time_limit),
        })),
      },
    })

    notice.value = 'Квиз успешно сохранен'
    if (!isEdit.value) {
      await router.replace(`/quiz-builder/${quizId}`)
    }
  } catch (err) {
    error.value = err.message || 'Ошибка сохранения'
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  if (isEdit.value) {
    loadQuiz(resolvedQuizId.value)
  } else {
    addQuestion()
  }
})
</script>

<template>
  <section class="builder-page">
    <div class="container">
      <div class="builder-head card">
        <div>
          <p class="eyebrow">Quiz studio</p>
          <h1>{{ isEdit ? 'Редактирование квиза' : 'Создание квиза' }}</h1>
          <p>Подготовьте вопросы, варианты ответов и правила запуска.</p>
        </div>
        <div class="builder-summary">
          <span><strong>{{ questions.length }}</strong> вопросов</span>
          <span><strong>{{ quizMeta.default_time_limit }}</strong> сек</span>
        </div>
      </div>

      <p v-if="loading" class="card">Загрузка...</p>

      <template v-else>
        <div class="builder-meta card meta-panel">
          <label>
            Название
            <input v-model="quizMeta.title" type="text" required />
          </label>

          <label>
            Категория
            <input v-model="quizMeta.category" type="text" />
          </label>

          <label>
            Время вопроса по умолчанию (сек)
            <input v-model.number="quizMeta.default_time_limit" type="number" min="5" max="180" />
          </label>

          <label>
            Описание
            <textarea v-model="quizMeta.description" rows="2" />
          </label>

          <label>
            Правила
            <textarea v-model="quizMeta.rules" rows="2" />
          </label>
        </div>

        <div class="builder-meta card settings-panel">
          <h2>Настройки квиза (режим как у конкурентных платформ)</h2>

          <label>
            Модель начисления очков
            <select v-model="quizMeta.settings.points_mode">
              <option value="speed">За точность и скорость</option>
              <option value="accuracy">Только за точность</option>
              <option value="disabled">Без очков</option>
            </select>
          </label>

          <label>
            Максимум попыток ответа на вопрос
            <input v-model.number="quizMeta.settings.max_attempts_per_question" type="number" min="1" max="10" />
          </label>

          <label>
            Обратный отсчет перед вопросом
            <select v-model.number="quizMeta.settings.countdown_seconds">
              <option :value="0">Без задержки</option>
              <option :value="3">3 секунды</option>
              <option :value="5">5 секунд</option>
              <option :value="10">10 секунд</option>
              <option :value="15">15 секунд</option>
              <option :value="30">30 секунд</option>
            </select>
          </label>

          <label class="check-label">
            <input v-model="quizMeta.settings.randomize_question_order" type="checkbox" />
            Перемешивать порядок вопросов
          </label>

          <label class="check-label">
            <input v-model="quizMeta.settings.randomize_answer_order" type="checkbox" />
            Перемешивать варианты ответа
          </label>

          <label class="check-label">
            <input v-model="quizMeta.settings.show_leaderboard_after_each_question" type="checkbox" />
            Показывать лидерборд после каждого вопроса
          </label>

          <label class="check-label">
            <input v-model="quizMeta.settings.show_correct_answers_after_question" type="checkbox" />
            Показывать правильный ответ сразу после вопроса
          </label>

          <label class="check-label">
            <input v-model="quizMeta.settings.allow_late_join" type="checkbox" />
            Разрешить подключение участников после старта
          </label>

          <label class="check-label">
            <input v-model="quizMeta.settings.allow_answer_change" type="checkbox" />
            Разрешить менять ответ до окончания таймера
          </label>
        </div>

        <div class="builder-actions">
          <button class="btn ghost" @click="addQuestion">+ Добавить вопрос</button>
          <button class="btn primary" :disabled="saving" @click="saveQuiz">
            {{ saving ? 'Сохраняем...' : 'Сохранить квиз' }}
          </button>
        </div>

        <p v-if="error" class="error-text">{{ error }}</p>
        <p v-if="notice" class="success-text">{{ notice }}</p>

        <article v-for="(question, qIndex) in questions" :key="qIndex" class="question-card card">
          <div class="question-head">
            <div>
              <span class="row-kicker">Question {{ qIndex + 1 }}</span>
              <h2>Вопрос {{ qIndex + 1 }}</h2>
            </div>
            <button class="btn ghost" @click="removeQuestion(qIndex)">Удалить</button>
          </div>

          <div class="builder-grid">
            <label>
              Текст вопроса
              <textarea v-model="question.text" rows="2" />
            </label>

            <label>
              URL изображения (необязательно)
              <input v-model="question.image_url" type="url" />
            </label>

            <label>
              Тип ответа
              <select v-model="question.question_type" @change="normalizeQuestionType(question)">
                <option value="single">Одиночный выбор</option>
                <option value="multiple">Множественный выбор</option>
              </select>
            </label>

            <label>
              Баллы
              <input v-model.number="question.points" type="number" min="1" max="1000" />
            </label>

            <label>
              Таймер (сек)
              <input v-model.number="question.time_limit" type="number" min="5" max="180" />
            </label>
          </div>

          <div class="options-list">
            <h3>Варианты ответа</h3>
            <div v-for="(option, optionIndex) in question.options" :key="optionIndex" class="option-row">
              <input
                :checked="option.is_correct"
                :type="question.question_type === 'single' ? 'radio' : 'checkbox'"
                :name="`question-${qIndex}`"
                @change="setOptionCorrect(question, optionIndex, $event.target.checked)"
              />
              <input
                v-model="option.text"
                class="option-input"
                type="text"
                placeholder="Вариант ответа"
              />
              <button class="btn ghost" :disabled="question.options.length <= 2" @click="removeOption(question, optionIndex)">Удалить</button>
            </div>
            <button class="btn ghost" :disabled="question.options.length >= 8" @click="addOption(question)">+ Добавить вариант</button>
          </div>
        </article>
      </template>
    </div>
  </section>
</template>
