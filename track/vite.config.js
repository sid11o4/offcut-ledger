import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Inline (empty) PostCSS config so Vite does not pick up the factory app's postcss.config.js
  // from the repo root, whose Tailwind plugin is not installed here and breaks host builds.
  css: { postcss: { plugins: [] } },
  test: { environment: 'node' },
})
