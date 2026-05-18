import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { clientsClaim } from 'workbox-core'

// Take control immediately
self.skipWaiting()
clientsClaim()

// Precache all app assets (injected by vite-plugin-pwa at build time)
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// ─── Push Notification Handler ───────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  const {
    title = 'Flowtone',
    body = '',
    url = '/',
    icon = '/icon-192x192.svg',
    tag = 'flowtone',
    actions = [],
    actionUrls = {},
  } = data

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: '/icon-192x192.svg',
      tag,
      // Store both the default url and per-action urls in notification data
      data: { url, actionUrls },
      actions,
      renotify: true,
    })
  )
})

// ─── Notification Click Handler ──────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const data = event.notification.data || {}

  // Resolve URL: action button → actionUrls[action], otherwise default url
  let target = data.url || '/'
  if (event.action && data.actionUrls && data.actionUrls[event.action]) {
    target = data.actionUrls[event.action]
  }

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Try to reuse an existing window
        for (const client of windowClients) {
          if ('focus' in client) {
            client.navigate(target)
            return client.focus()
          }
        }
        return clients.openWindow(target)
      })
  )
})
