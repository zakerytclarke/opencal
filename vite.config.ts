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

/** Incrementing version: 1.0.<commit count>, so it bumps automatically on each commit. */
const gitVersion = (() => {
  try {
    const n = parseInt(execSync('git rev-list --count HEAD').toString().trim(), 10)
    if (Number.isFinite(n) && n >= 0) return `1.0.${n}`
  } catch {
    /* not a repo / git unavailable */
  }
  return '1.0.0'
})()

// Expose the build tag to both dev (Vite serves import.meta.env from process.env)
// and build (Vitest/rollup pick it up from process.env before build starts).
process.env.VITE_OPC_BUILD = process.env.VITE_OPC_BUILD ?? `${gitSha} @ ${new Date().toISOString()}`
process.env.VITE_OPC_VERSION = process.env.VITE_OPC_VERSION ?? gitVersion

export default defineConfig({
  // Relative base: serves correctly from any mount path (apex or the legacy
  // <repo> subpath) and survives repo renames. Absolute /repo/ paths broke the
  // asset URLs after the repo was renamed.
  base: './',
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
