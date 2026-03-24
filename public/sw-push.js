// Flowtone Push Notification Service Worker
// Handles push events and notification clicks independently of the VitePWA SW.

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const {
    title = 'Flowtone',
    body = '',
    url = '/',
    icon = '/icon-192x192.svg',
    tag = 'flowtone',
    actions = [],
  } = data;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: '/icon-192x192.svg',
      tag,
      data: { url },
      actions,
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if ('focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return clients.openWindow(url);
      })
  );
});
