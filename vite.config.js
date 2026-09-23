import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    // scubo-lead-desk/ is a separate app with its own test run.
    exclude: [...configDefaults.exclude, 'scubo-lead-desk/**'],
  },
})
