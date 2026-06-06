<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()

const loading = ref(true)
const error = ref('')
const quizzes = ref([])
const historyItems = ref([])

const activeLaunches = computed(() => historyItems.value.filter((item) => item.status === 'active').length)
const finishedLaunches = computed(() => historyItems.value.filter((item) => item.status === 'finished').length)
const totalScore = computed(() => historyItems.value.reduce((sum, item) => sum + Number(item.score || 0), 0))

async function loadData() {
  loading.value = true
  error.value = ''
  try {
    if (auth.isOrganizer) {
      quizzes.value = await api.request('/api/quizzes/my', {
        headers: api.authHeader(auth.token),
      })
    }

    const history = await api.request('/api/history', {
      headers: api.authHeader(auth.token),
    })
    historyItems.value = history.items
  } catch (err) {
    error.value = err.message || 'Не удалось загрузить данные'
  } finally {
    loading.value = false
  }
}

async function launchQuiz(quizId) {
  try {
    const launch = await api.request('/api/sessions', {
      method: 'POST',
      headers: api.authHeader(auth.token),
      body: { quiz_id: quizId },
    })
    router.push(`/live/host/${launch.room_code}`)
  } catch (err) {
    error.value = err.message || 'Не удалось запустить квиз'
  }
}

function statusLabel(status) {
  if (status === 'waiting') return 'Ожидание'
  if (status === 'active') return 'Активен'
  return 'Завершен'
}

onMounted(loadData)
</script>

<template>
  <section class="dashboard-page">
    <div class="container">
      <header class="dashboard-head">
        <div>
          <p class="eyebrow">{{ auth.isOrganizer ? 'Admin cockpit' : 'Player hub' }}</p>
          <h1>Личный кабинет</h1>
          <p>
            {{ auth.isOrganizer ? 'Управляйте квизами и запускайте сессии.' : 'Подключайтесь к квизам и следите за прогрессом.' }}
          </p>
        </div>
      </header>

      <p v-if="error" class="error-text">{{ error }}</p>

      <div v-if="loading" class="card">Загрузка...</div>

      <template v-else>
        <div class="dashboard-stats">
          <article class="stat-card">
            <span>{{ auth.isOrganizer ? 'Квизы' : 'Участий' }}</span>
            <strong>{{ auth.isOrganizer ? quizzes.length : historyItems.length }}</strong>
          </article>
          <article class="stat-card">
            <span>{{ auth.isOrganizer ? 'Активные комнаты' : 'Набрано очков' }}</span>
            <strong>{{ auth.isOrganizer ? activeLaunches : totalScore }}</strong>
          </article>
          <article class="stat-card hot">
            <span>{{ auth.isOrganizer ? 'Завершено' : 'Лучший результат' }}</span>
            <strong>{{ auth.isOrganizer ? finishedLaunches : Math.max(0, ...historyItems.map((item) => Number(item.score || 0))) }}</strong>
          </article>
        </div>

        <div class="quick-grid">
          <article class="quick-card">
            <span class="quick-icon">{{ auth.isOrganizer ? 'CREATE' : 'JOIN' }}</span>
            <h2>{{ auth.isOrganizer ? 'Создать новый квиз' : 'Войти в комнату' }}</h2>
            <p>
              {{ auth.isOrganizer ? 'Соберите вопросы и подготовьте запуск.' : 'Введите код комнаты и начните играть.' }}
            </p>
            <RouterLink
              class="btn primary"
              :to="auth.isOrganizer ? '/quiz-builder/new' : '/join'"
            >
              {{ auth.isOrganizer ? 'Создать квиз' : 'Присоединиться' }}
            </RouterLink>
          </article>

          <article class="quick-card">
            <span class="quick-icon green">{{ auth.isOrganizer ? 'LIVE' : 'SCORE' }}</span>
            <h2>{{ auth.isOrganizer ? 'Провести live-сессию' : 'История участия' }}</h2>
            <p>
              {{ auth.isOrganizer ? 'Запускайте комнату и ведите квиз в реальном времени.' : 'Результаты квизов и ваши очки.' }}
            </p>
            <RouterLink class="btn ghost" to="/join">
              {{ auth.isOrganizer ? 'Проверить вход участника' : 'Открыть подключение' }}
            </RouterLink>
          </article>
        </div>

        <section v-if="auth.isOrganizer" class="dashboard-block">
          <div class="block-title-row">
            <h2>Мои квизы</h2>
            <RouterLink class="btn ghost" to="/quiz-builder/new">+ Новый</RouterLink>
          </div>

          <div v-if="quizzes.length === 0" class="card">Пока нет квизов. Создайте первый.</div>

          <div v-for="quiz in quizzes" :key="quiz.id" class="quiz-row card">
            <div>
              <span class="row-kicker">{{ quiz.category }}</span>
              <h3>{{ quiz.title }}</h3>
              <p>{{ quiz.description || 'Без описания' }}</p>
            </div>
            <div class="quiz-row-actions">
              <RouterLink class="btn ghost" :to="`/quiz-builder/${quiz.id}`">Редактировать</RouterLink>
              <button class="btn primary" @click="launchQuiz(quiz.id)">Запустить</button>
            </div>
          </div>
        </section>

        <section class="dashboard-block">
          <h2>{{ auth.isOrganizer ? 'История запусков' : 'Пройденные квизы' }}</h2>
          <div v-if="historyItems.length === 0" class="card">История пока пустая.</div>

          <div v-for="item in historyItems" :key="item.launch_id" class="history-row card">
            <div>
              <h3>{{ item.quiz_title }}</h3>
              <p>Комната: {{ item.room_code }} · Статус: {{ statusLabel(item.status) }}</p>
            </div>
            <div class="history-meta">
              <span v-if="item.score !== null">Очки: {{ item.score }}</span>
              <RouterLink v-if="auth.isOrganizer" class="btn ghost" :to="`/live/host/${item.room_code}`">Открыть</RouterLink>
              <RouterLink v-else class="btn ghost" :to="`/live/play/${item.room_code}`">Открыть</RouterLink>
            </div>
          </div>
        </section>
      </template>
    </div>
  </section>
</template>
