import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [vue(), ...(mode === 'https' ? [basicSsl()] : [])],
  server: {
    host: mode === 'https' ? '0.0.0.0' : 'localhost',
    port: 5173,
    strictPort: true,
  },
}))
