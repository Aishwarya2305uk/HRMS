import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // PORT lets the launcher assign a free port when 5190 is taken.
    port: Number(process.env.PORT) || 5190,
    proxy: {
      // Forward API calls to the Express backend during development.
      // API_PROXY_TARGET lets a second stack run beside the main one (e.g.
      // dev:mem on another port while the real API holds 4000).
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
