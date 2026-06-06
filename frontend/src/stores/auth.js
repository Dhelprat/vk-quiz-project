import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { api } from '../lib/api'

const TOKEN_KEY = 'quizhub_token'
const USER_KEY = 'quizhub_user'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem(TOKEN_KEY) || '')
  const user = ref(localStorage.getItem(USER_KEY) ? JSON.parse(localStorage.getItem(USER_KEY)) : null)

  const isAuthenticated = computed(() => Boolean(token.value))
  const isOrganizer = computed(() => user.value?.role === 'organizer')

  function setSession(payload) {
    token.value = payload.access_token
    user.value = payload.user
    localStorage.setItem(TOKEN_KEY, token.value)
    localStorage.setItem(USER_KEY, JSON.stringify(user.value))
  }

  function clearSession() {
    token.value = ''
    user.value = null
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  }

  async function register(form) {
    const payload = await api.request('/api/auth/register', {
      method: 'POST',
      body: form,
    })
    setSession(payload)
  }

  async function login(form) {
    const payload = await api.request('/api/auth/login', {
      method: 'POST',
      body: form,
    })
    setSession(payload)
  }

  async function loadProfile() {
    if (!token.value) return
    try {
      const profile = await api.request('/api/auth/me', {
        headers: api.authHeader(token.value),
      })
      user.value = profile
      localStorage.setItem(USER_KEY, JSON.stringify(user.value))
    } catch (error) {
      clearSession()
      throw error
    }
  }

  return {
    token,
    user,
    isAuthenticated,
    isOrganizer,
    setSession,
    clearSession,
    register,
    login,
    loadProfile,
  }
})
