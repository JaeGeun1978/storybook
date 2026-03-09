import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Vercel: base='/' (기본값), GitHub Pages: base='/storybook/'
export default defineConfig({
  base: process.env.VITE_BASE || '/',
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
