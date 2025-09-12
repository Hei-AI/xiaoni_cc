import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3003,
    cors: true,
    proxy: {
      // Admin Panel API (port 9080)
      '/api/tokens': {
        target: 'http://localhost:9080',
        changeOrigin: true
      },
      '/api/conversations': {
        target: 'http://localhost:9080',
        changeOrigin: true
      },
      '/api/logs': {
        target: 'http://localhost:9080',
        changeOrigin: true
      },
      '/api/config': {
        target: 'http://localhost:9080',
        changeOrigin: true
      },
      '/api/dashboard': {
        target: 'http://localhost:9080',
        changeOrigin: true
      },
      // Debug API moved to Admin Backend (port 9080)
      '/api/debug': {
        target: 'http://localhost:9080',
        changeOrigin: true
      },
      '/api/test': {
        target: 'http://localhost:8081',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})