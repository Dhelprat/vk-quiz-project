import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { api } from '../lib/api'

export const useAuthStore = defineStore('auth', () => {
  const token = ref('')
  const user = ref(null)
  const initialized = ref(false)

  const isAuthenticated = computed(() => Boolean(user.value))
  const isOrganizer = computed(() => user.value?.role === 'organizer')

  function setSession(payload) {
    user.value = payload.user
  }

  function clearSession() {
    token.value = ''
    user.value = null
    localStorage.removeItem('quizhub_token')
    localStorage.removeItem('quizhub_user')
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
    try {
      const profile = await api.request('/api/auth/me', {
        headers: api.authHeader(token.value),
      })
      user.value = profile
    } catch (error) {
      clearSession()
      throw error
    }
  }

  async function initialize() {
    if (initialized.value) return
    initialized.value = true
    localStorage.removeItem('quizhub_token')
    localStorage.removeItem('quizhub_user')
    await loadProfile().catch(() => {})
  }

  async function logout() {
    await api.request('/api/auth/logout', { method: 'POST' }).catch(() => {})
    clearSession()
  }

  return {
    token,
    user,
    isAuthenticated,
    isOrganizer,
    initialized,
    setSession,
    clearSession,
    register,
    login,
    loadProfile,
    initialize,
    logout,
  }
})
