import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

import DashboardView from '../views/DashboardView.vue'
import HomeView from '../views/HomeView.vue'
import JoinView from '../views/JoinView.vue'
import LiveHostView from '../views/LiveHostView.vue'
import LivePlayerView from '../views/LivePlayerView.vue'
import LoginView from '../views/LoginView.vue'
import NotFoundView from '../views/NotFoundView.vue'
import QuizBuilderView from '../views/QuizBuilderView.vue'
import RegisterView from '../views/RegisterView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/register', name: 'register', component: RegisterView },
    { path: '/dashboard', name: 'dashboard', component: DashboardView, meta: { auth: true } },
    { path: '/join', name: 'join', component: JoinView, meta: { auth: true } },
    { path: '/quiz-builder/:quizId?', name: 'builder', component: QuizBuilderView, meta: { auth: true, organizer: true } },
    { path: '/live/host/:roomCode', name: 'live-host', component: LiveHostView, meta: { auth: true, organizer: true } },
    { path: '/live/play/:roomCode', name: 'live-play', component: LivePlayerView, meta: { auth: true } },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  if (auth.token && !auth.user) {
    await auth.loadProfile().catch(() => {})
  }

  if (to.meta.auth && !auth.isAuthenticated) {
    return { name: 'login', query: { next: to.fullPath } }
  }

  if ((to.name === 'login' || to.name === 'register') && auth.isAuthenticated) {
    return { name: 'dashboard' }
  }

  if (to.meta.organizer && !auth.isOrganizer) {
    return { name: 'dashboard' }
  }

  return true
})

export default router
