/* ClassChat — request notification permission, register service worker, subscribe to push */
(function() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = window.atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function registerAndSubscribe() {
    navigator.serviceWorker.register('/sw.js')
      .then(function(reg) {
        return reg.pushManager.getSubscription().then(function(sub) {
          if (sub) return sub;
          return fetch('/api/notifications/vapid-public', { credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              var key = data.publicKey;
              if (!key) return null;
              return reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(key)
              });
            });
        });
      })
      .then(function(sub) {
        if (!sub) return;
        return fetch('/api/notifications/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(sub.toJSON())
        });
      })
      .catch(function() {});
  }

  if (Notification.permission === 'granted') {
    registerAndSubscribe();
  } else if (Notification.permission === 'default') {
    var requested = false;
    function tryRequest() {
      if (requested) return;
      requested = true;
      Notification.requestPermission().then(function(p) {
        if (p === 'granted') registerAndSubscribe();
      });
    }
    document.addEventListener('click', tryRequest, { once: true });
    setTimeout(function() { if (!requested && document.visibilityState === 'visible') tryRequest(); }, 2000);
  }
})();
