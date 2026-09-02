import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const gitSha = (() => {
  try {
    // Best-effort commit sha for the build tag, so the console shows which build.
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
})()

// Expose the build tag to both dev (Vite serves import.meta.env from process.env)
// and build (Vitest/rollup pick it up from process.env before build starts).
process.env.VITE_OPC_BUILD = process.env.VITE_OPC_BUILD ?? `${gitSha} @ ${new Date().toISOString()}`

export default defineConfig({
  base: process.env.GITHUB_PAGES === '1' ? '/opencal/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'foods.json'],
      manifest: {
        name: 'OpenCal',
        short_name: 'OpenCal',
        description: 'On-device calorie tracker — USDA foods, voice, and photo logging.',
        theme_color: '#0F1419',
        background_color: '#0F1419',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,json,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
})
