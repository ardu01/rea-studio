import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rolldownOptions: {
        input: resolve('electron/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rolldownOptions: {
        input: resolve('electron/preload/index.ts'),
        output: {
          format: 'cjs',
          entryFileNames: 'index.js',
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
      },
    },
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: 43123,
      strictPort: true,
    },
  },
})
