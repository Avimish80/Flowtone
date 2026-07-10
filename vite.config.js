import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  logLevel: 'info',
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
      },
      includeAssets: ['icon.svg', 'icon-192x192.svg', 'icon-512x512.svg'],
      manifest: {
        name: 'Flowtone',
        short_name: 'Flowtone',
        description: "The musician's business OS",
        theme_color: '#1e1b4b',
        background_color: '#030712',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        orientation: 'portrait-primary',
        categories: ['music', 'productivity', 'business'],
        icons: [
          {
            src: '/icon-192x192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/icon-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Calendar',
            short_name: 'Calendar',
            url: '/?page=CalendarView',
            description: 'Jump to your calendar',
          },
          {
            name: 'New Event',
            short_name: 'New Event',
            url: '/?page=WorkEventDetail',
            description: 'Add a new gig or session',
          },
          {
            name: 'Practice',
            short_name: 'Practice',
            url: '/?page=Practice',
            description: 'Open your practice hub',
          },
        ],
      },
    }),
  ],
  server: {
    host: true,        // listen on 0.0.0.0 so phones on the same WiFi can connect
    port: parseInt(process.env.PORT) || 5173,
    strictPort: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
