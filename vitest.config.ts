import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
})
