import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const { LOCAL_API_TARGET } = loadEnv(mode, process.cwd(), 'LOCAL_')
  const apiProxy = { '/api': LOCAL_API_TARGET || 'http://127.0.0.1:8787' }
  return {
    plugins: [react()],
    server: { host: '127.0.0.1', proxy: apiProxy },
    preview: { host: '127.0.0.1', proxy: apiProxy },
  }
})
