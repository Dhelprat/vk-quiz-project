<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const isLiveRoute = computed(() => route.name === 'live-host' || route.name === 'live-play')

async function logout() {
  await auth.logout()
  await router.push({ name: 'home' })
}
</script>

<template>
  <header v-if="!isLiveRoute" class="topbar">
    <div class="container nav-wrap">
      <RouterLink class="brand" to="/">
        <span class="brand-mark" aria-hidden="true">
          <span class="brand-question">?</span>
          <span class="brand-spark"></span>
        </span>
        <span class="brand-text">QuizHub</span>
      </RouterLink>

      <nav v-if="auth.isAuthenticated || route.path !== '/'" class="nav-links">
        <RouterLink v-if="route.path !== '/'" to="/">На главную</RouterLink>
        <RouterLink v-if="auth.isAuthenticated" to="/dashboard">Кабинет</RouterLink>
        <RouterLink v-if="auth.isAuthenticated" to="/join">Присоединиться</RouterLink>
      </nav>

      <div class="nav-actions">
        <RouterLink v-if="!auth.isAuthenticated" class="btn ghost" to="/login">Войти</RouterLink>
        <RouterLink v-if="!auth.isAuthenticated" class="btn primary" to="/register">Регистрация</RouterLink>
        <button v-if="auth.isAuthenticated" class="btn primary" @click="logout">Выйти</button>
      </div>
    </div>
  </header>
</template>
