<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()

const form = reactive({
  roomCode: '',
  displayName: auth.user?.full_name || '',
})

const loading = ref(false)
const error = ref('')

async function join() {
  error.value = ''
  loading.value = true

  try {
    const roomCode = form.roomCode.trim().toUpperCase()
    await api.request(`/api/sessions/${roomCode}/join`, {
      method: 'POST',
      headers: api.authHeader(auth.token),
      body: { display_name: form.displayName.trim() },
    })
    router.push(`/live/play/${roomCode}`)
  } catch (err) {
    error.value = err.message || 'Не удалось присоединиться'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="join-page">
    <div class="join-card">
      <div class="join-header">
        <div class="join-icon">PLAY</div>
        <p class="eyebrow center">Join arena</p>
        <h1>Подключение к квизу</h1>
        <p>Введите имя и код комнаты, который сообщил организатор.</p>
      </div>

      <form class="form" @submit.prevent="join">
        <label>
          Имя участника
          <input v-model="form.displayName" type="text" minlength="2" required />
        </label>

        <label>
          Код комнаты
          <input
            v-model="form.roomCode"
            class="code-input"
            type="text"
            minlength="4"
            maxlength="12"
            required
            placeholder="ABCD1234"
          />
        </label>

        <p v-if="error" class="error-text">{{ error }}</p>

        <button class="btn primary full" :disabled="loading">
          {{ loading ? 'Подключаем...' : 'Войти в комнату' }}
        </button>
      </form>

      <div class="join-hints">
        <div class="hint"><strong>1</strong><span>Код комнаты состоит из букв и цифр, например A7K2M9QX.</span></div>
        <div class="hint"><strong>2</strong><span>Быстрый правильный ответ может дать больше очков.</span></div>
        <div class="hint"><strong>3</strong><span>До старта вы попадете в ожидание комнаты.</span></div>
      </div>
    </div>
  </section>
</template>
