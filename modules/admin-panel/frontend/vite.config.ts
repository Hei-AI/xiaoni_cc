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
    host: process.env.VITE_DEV_HOST || '127.0.0.1',
    port: Number.parseInt(process.env.VITE_DEV_PORT || '3003', 10),
    strictPort: true,
    cors: true,
    proxy: {
      // 本地前端继续代理到容器内 admin-backend
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:9080',
        changeOrigin: true,
        secure: false,
        timeout: 600000,
        proxyTimeout: 600000,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.log('Proxy error:', err);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('Proxying request:', req.method, req.url);
          });
        }
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
