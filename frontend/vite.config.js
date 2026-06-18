import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const backendTarget = process.env.VITE_BACKEND_TARGET || 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
        ws: true,
      },
      '/socket.io': {
        target: backendTarget,
        changeOrigin: true,
        ws: true,
      },
      '/uploads': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
})
