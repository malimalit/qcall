
self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {};
  const title = data.title || '🎉 Your order is ready!';
  const options = {
    body: data.body || 'Please come pick up your order at the counter.',
    icon: '/icon.png',
    badge: '/icon.png',
    vibrate: [500, 200, 500, 200, 500, 200, 1000],
    requireInteraction: true,
    tag: 'order-ready',
    renotify: true,
    data: { orderId: data.orderId, url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
