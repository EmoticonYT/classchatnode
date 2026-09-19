/* ClassChat Service Worker — push notifications when tab is closed */
self.addEventListener('push', function(event) {
  var data = { title: 'ClassChat', body: '' };
  try {
    if (event.data) data = event.data.json();
  } catch (_) {
    if (event.data) data.body = event.data.text();
  }
  var opts = {
    body: data.body || '',
    icon: data.icon || '/favicon.ico',
    tag: data.tag || 'classchat-notification',
    requireInteraction: !!data.requireInteraction,
    data: { url: data.url || '/messages' }
  };
  event.waitUntil(
    self.registration.showNotification(data.title || 'ClassChat', opts)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/messages';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        if (windowClients[i].url.indexOf(self.location.origin) === 0 && 'focus' in windowClients[i]) {
          windowClients[i].navigate(url);
          return windowClients[i].focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
