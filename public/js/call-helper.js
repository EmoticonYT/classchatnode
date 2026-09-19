(function() {
  var modal = document.getElementById('incoming-call-modal');
  var fromEl = document.getElementById('incoming-call-from');
  var titleEl = document.getElementById('incoming-call-title');
  var acceptBtn = document.getElementById('incoming-call-accept');
  var declineBtn = document.getElementById('incoming-call-decline');
  if (!modal || !fromEl) return;
  if (!titleEl) titleEl = modal.querySelector('.incoming-call-title') || fromEl;

  var ws = null;
  var incomingFromId = null;
  var incomingUsername = null;
  var incomingVideo = true;

  var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var wsUrl = protocol + '//' + location.host + '/call/ws';

  function connect() {
    fetch('/api/call/token', { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        ws = new WebSocket(wsUrl + '?token=' + encodeURIComponent(data.token));
        ws.onmessage = function(ev) {
          var msg;
          try { msg = JSON.parse(ev.data); } catch (_) { return; }
          if (msg.type === 'incoming-call') {
            incomingFromId = msg.from;
            incomingUsername = msg.username || ('user#' + msg.from);
            incomingVideo = msg.video !== false;
            fromEl.textContent = '@' + incomingUsername;
            titleEl.textContent = incomingVideo ? 'Incoming video call' : 'Incoming audio call';
            modal.style.display = 'flex';
            try {
              if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                new Notification(incomingVideo ? 'Incoming video call' : 'Incoming audio call', { body: '@' + incomingUsername + ' is calling you', icon: '/favicon.ico' });
              }
            } catch (_) {}
          }
        };
        ws.onclose = function() { ws = null; };
      })
      .catch(function() {});
  }

  if (acceptBtn) {
    acceptBtn.addEventListener('click', function() {
      if (incomingFromId == null) return;
      modal.style.display = 'none';
      var url = '/call/' + encodeURIComponent(incomingUsername) + '?incoming=1' + (incomingVideo ? '' : '&audio=1');
      window.open(url, 'classchat-call', 'width=800,height=600');
      incomingFromId = null;
      incomingUsername = null;
    });
  }
  if (declineBtn) {
    declineBtn.addEventListener('click', function() {
      if (ws && ws.readyState === 1 && incomingFromId != null) {
        ws.send(JSON.stringify({ type: 'decline', from: incomingFromId }));
      }
      modal.style.display = 'none';
      incomingFromId = null;
      incomingUsername = null;
    });
  }

  connect();
})();
