<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const form = reactive({
  email: '',
  password: '',
})

const loading = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await auth.login(form)
    router.push(route.query.next || '/dashboard')
  } catch (err) {
    error.value = err.message || 'Ошибка входа'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="auth-page">
    <div class="auth-card">
      <h1>Вход</h1>
      <p class="subtext">Войдите, чтобы запускать и проходить квизы.</p>

      <form class="form" @submit.prevent="submit">
        <label>
          Email
          <input v-model="form.email" type="email" required />
        </label>

        <label>
          Пароль
          <input v-model="form.password" type="password" required />
        </label>

        <p v-if="error" class="error-text">{{ error }}</p>

        <button class="btn primary full" :disabled="loading">
          {{ loading ? 'Входим...' : 'Войти' }}
        </button>
      </form>

      <p class="subtext small">
        Нет аккаунта?
        <RouterLink to="/register">Создать</RouterLink>
      </p>
    </div>
  </section>
</template>
