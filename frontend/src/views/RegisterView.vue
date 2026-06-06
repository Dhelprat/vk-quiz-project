<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const form = reactive({
  full_name: '',
  email: '',
  password: '',
  role: 'participant',
})

const loading = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await auth.register(form)
    router.push(route.query.next || '/dashboard')
  } catch (err) {
    error.value = err.message || 'Ошибка регистрации'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="auth-page">
    <div class="auth-card">
      <h1>Регистрация</h1>
      <p class="subtext">Выберите роль и начните работу с QuizHub.</p>

      <form class="form" @submit.prevent="submit">
        <label>
          ФИО / Никнейм
          <input v-model="form.full_name" type="text" required minlength="2" />
        </label>

        <label>
          Email
          <input v-model="form.email" type="email" required />
        </label>

        <label>
          Пароль
          <input v-model="form.password" type="password" required minlength="6" />
        </label>

        <label>
          Роль
          <select v-model="form.role">
            <option value="participant">Участник</option>
            <option value="organizer">Организатор</option>
          </select>
        </label>

        <p v-if="error" class="error-text">{{ error }}</p>

        <button class="btn primary full" :disabled="loading">
          {{ loading ? 'Создаем...' : 'Создать аккаунт' }}
        </button>
      </form>

      <p class="subtext small">
        Уже есть аккаунт?
        <RouterLink to="/login">Войти</RouterLink>
      </p>
    </div>
  </section>
</template>
