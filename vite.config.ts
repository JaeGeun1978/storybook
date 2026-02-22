import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/gemini': {
        target: 'https://generativelanguage.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gemini/, ''),
        secure: true,
      },
      '/api/streamelements': {
        target: 'https://api.streamelements.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/streamelements/, ''),
        secure: true,
      },
      '/api/tts/google': {
        target: 'https://translate.google.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tts\/google/, ''),
        secure: true,
      },
      '/api/tts/youdao': {
        target: 'https://dict.youdao.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tts\/youdao/, ''),
        secure: true,
      },
    },
  },
})
