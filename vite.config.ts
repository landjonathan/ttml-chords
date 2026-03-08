import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { ugProxyPlugin } from './src/server/ugProxy'

export default defineConfig({
  base: process.env.NETLIFY ? '/' : '/oz-playground/',
  plugins: [vue(), ugProxyPlugin()],
})
