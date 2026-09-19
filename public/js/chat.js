/**
 * ClassChat - Real-Time Seamless Chat Engine
 */
(function() {
  const feed = document.getElementById('message-feed');
  const form = document.getElementById('conversation-form');
  const textarea = document.getElementById('msg-body');
  const sendBtn = document.getElementById('btn-send');
  const typingEl = document.getElementById('typing-indicator');
  const typingText = document.getElementById('typing-text');
  const onlineBadge = document.getElementById('user-online-badge');
  const replyToInput = document.getElementById('reply_to');
  const replyPreview = document.getElementById('reply-preview');
  const replyPreviewText = document.getElementById('reply-preview-text');
  const replyCancel = document.getElementById('reply-cancel');
  const previewTray = document.getElementById('compose-preview-tray');
  const newMsgPill = document.getElementById('new-message-pill');
  const loadMoreContainer = document.getElementById('load-more-container');
  const btnLoadMore = document.getElementById('btn-load-more');
  const loadingOlderSpinner = document.getElementById('loading-older-spinner');

  if (!feed || !form) return;

  const currentUsername = form.dataset.currentUser;
  const currentUserId = Number(form.dataset.currentUserId);
  const otherUsername = form.dataset.otherUser;
  const otherUserId = Number(form.dataset.otherUserId);

  let ws = null;
  let wsReconnectTimer = null;
  let typingTimeout = null;
  let lastTypingSent = 0;
  let incomingTypingTimer = null;

  // --- Audio Chime via Web Audio API (Zero external file dependencies) ---
  let audioCtx = null;
  function getAudioContext() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioCtx = new AudioContext();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  // Unlock browser audio context on first user interaction
  document.addEventListener('click', function unlockAudio() {
    getAudioContext();
  }, { once: true });
  document.addEventListener('keydown', function unlockAudio() {
    getAudioContext();
  }, { once: true });

  function playIncomingChime() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      // Crisp, pleasant two-tone chime: F5 (698.46 Hz) -> A5 (880 Hz)
      osc.frequency.setValueAtTime(698.46, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch (_) {}
  }

  // --- Smart Auto Scroll ---
  function isNearBottom() {
    return feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
  }

  function scrollToBottom(smooth) {
    if (smooth) {
      feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
    } else {
      feed.scrollTop = feed.scrollHeight;
    }
    if (newMsgPill) newMsgPill.style.display = 'none';
  }

  let isLoadingOlder = false;
  let allOlderLoaded = !loadMoreContainer || loadMoreContainer.style.display === 'none';
  let scrollCheckTimer = null;

  feed.addEventListener('scroll', function() {
    if (isNearBottom() && newMsgPill) {
      newMsgPill.style.display = 'none';
    }
    // Infinite upward scroll trigger
    if (feed.scrollTop < 60 && !isLoadingOlder && !allOlderLoaded) {
      if (scrollCheckTimer) clearTimeout(scrollCheckTimer);
      scrollCheckTimer = setTimeout(loadOlderMessages, 120);
    }
  });

  if (newMsgPill) {
    newMsgPill.addEventListener('click', function() {
      scrollToBottom(true);
    });
  }

  // Initial immediate scroll to bottom
  feed.scrollTop = feed.scrollHeight;

  // --- WebSocket Connection ---
  function connectWs() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    fetch('/api/call/token', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(data => {
        if (!data || !data.token) return;
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${location.host}/ws?token=${encodeURIComponent(data.token)}`;
        ws = new WebSocket(wsUrl);

        ws.onopen = function() {
          if (wsReconnectTimer) {
            clearTimeout(wsReconnectTimer);
            wsReconnectTimer = null;
          }
          // Request other user's online presence
          ws.send(JSON.stringify({ type: 'check_online', username: otherUsername }));
        };

        ws.onmessage = function(ev) {
          let msg;
          try { msg = JSON.parse(ev.data); } catch (_) { return; }

          if (msg.type === 'online_status' && msg.username === otherUsername) {
            updateOnlineStatus(msg.isOnline);
          }

          if (msg.type === 'typing' && (msg.username === otherUsername || msg.from === otherUserId)) {
            handleRemoteTyping(msg.typing);
          }

          if (msg.type === 'delete_message') {
            handleRemoteDelete(msg.messageId);
          }

          if (msg.type === 'new_message') {
            const m = msg.message;
            if (!m) return;
            const isForThisChat =
              (m.sender_username === otherUsername && m.receiver_id === currentUserId) ||
              (m.sender_id === currentUserId && (m.receiver_id === otherUserId || msg.conversationWith === otherUsername));

            if (isForThisChat) {
              appendMessage(m);
            }
          }
        };

        ws.onclose = function() {
          ws = null;
          if (!wsReconnectTimer) {
            wsReconnectTimer = setTimeout(connectWs, 2500);
          }
        };

        ws.onerror = function() {
          try { ws.close(); } catch (_) {}
        };
      })
      .catch(() => {
        if (!wsReconnectTimer) {
          wsReconnectTimer = setTimeout(connectWs, 3000);
        }
      });
  }

  connectWs();

  // --- Online Presence UI ---
  function updateOnlineStatus(isOnline) {
    if (!onlineBadge) return;
    if (isOnline) {
      onlineBadge.className = 'status-dot online';
      onlineBadge.title = 'Online now';
      const text = document.getElementById('user-online-text');
      if (text) {
        text.textContent = 'Active now';
        text.className = 'chat-online-text online';
      }
    } else {
      onlineBadge.className = 'status-dot offline';
      onlineBadge.title = 'Offline';
      const text = document.getElementById('user-online-text');
      if (text) {
        text.textContent = 'Offline';
        text.className = 'chat-online-text offline';
      }
    }
  }

  // --- Remote Typing Handler ---
  function handleRemoteTyping(isTyping) {
    if (!typingEl) return;
    if (incomingTypingTimer) clearTimeout(incomingTypingTimer);

    if (isTyping) {
      if (typingText) typingText.textContent = `@${otherUsername} is typing...`;
      typingEl.style.display = 'inline-flex';
      if (isNearBottom()) scrollToBottom(true);
      incomingTypingTimer = setTimeout(() => {
        typingEl.style.display = 'none';
      }, 3500);
    } else {
      typingEl.style.display = 'none';
    }
  }

  // --- Remote Message Delete ---
  function handleRemoteDelete(messageId) {
    const el = feed.querySelector(`[data-message-id="${messageId}"]`);
    if (el) {
      el.style.transition = 'opacity 0.25s ease, transform 0.25s ease, max-height 0.25s ease';
      el.style.opacity = '0';
      el.style.transform = 'scale(0.95)';
      setTimeout(() => el.remove(), 260);
    }
  }

  // --- Outgoing Typing Notifications ---
  function notifyTyping(isTyping) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'typing',
      to: otherUsername,
      typing: isTyping,
    }));
  }

  if (textarea) {
    textarea.addEventListener('input', function() {
      autoResizeTextarea();
      const now = Date.now();
      if (now - lastTypingSent > 1500) {
        lastTypingSent = now;
        notifyTyping(true);
      }
      if (typingTimeout) clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        notifyTyping(false);
      }, 2000);
    });
  }

  function autoResizeTextarea() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 120);
    textarea.style.height = newHeight + 'px';
  }

  // --- Reply Handling ---
  document.addEventListener('click', function(e) {
    const replyBtn = e.target.closest('.reply-to-btn');
    if (replyBtn) {
      const msgId = replyBtn.dataset.messageId;
      const snippet = replyBtn.dataset.replyBody || '';
      if (replyToInput) replyToInput.value = msgId;
      if (replyPreviewText) replyPreviewText.textContent = snippet;
      if (replyPreview) replyPreview.style.display = 'flex';
      if (textarea) textarea.focus();
    }
  });

  if (replyCancel) {
    replyCancel.addEventListener('click', function() {
      if (replyToInput) replyToInput.value = '';
      if (replyPreview) replyPreview.style.display = 'none';
    });
  }

  // --- Attachment Pickers & Preview Tray ---
  const fileInputs = form.querySelectorAll('input[type="file"]');
  fileInputs.forEach(input => {
    input.addEventListener('change', function() {
      renderAttachmentPreviews();
    });
  });

  function renderAttachmentPreviews() {
    if (!previewTray) return;
    previewTray.innerHTML = '';
    let count = 0;

    fileInputs.forEach(input => {
      if (input.files && input.files[0]) {
        count++;
        const file = input.files[0];
        const chip = document.createElement('div');
        chip.className = 'attachment-preview-chip';

        if (file.type.startsWith('image/')) {
          const img = document.createElement('img');
          img.src = URL.createObjectURL(file);
          chip.appendChild(img);
        } else {
          const icon = document.createElement('span');
          icon.textContent = file.type.startsWith('video/') ? '🎬 ' : '📎 ';
          chip.appendChild(icon);
        }

        const name = document.createElement('span');
        name.className = 'preview-filename';
        name.textContent = file.name;
        chip.appendChild(name);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'preview-remove-btn';
        removeBtn.innerHTML = '&times;';
        removeBtn.title = 'Remove attachment';
        removeBtn.addEventListener('click', () => {
          input.value = '';
          renderAttachmentPreviews();
        });
        chip.appendChild(removeBtn);

        previewTray.appendChild(chip);
      }
    });

    previewTray.style.display = count > 0 ? 'flex' : 'none';
  }

  // --- Build Message Element in DOM ---
  function buildMessageElement(m, isOptimistic = false) {
    const isSent = m.sender_id === currentUserId || m.sender_username === currentUsername;
    const msgEl = document.createElement('div');
    msgEl.className = `dm-message ${isSent ? 'dm-sent' : 'dm-received'}`;
    if (m.id) msgEl.dataset.messageId = m.id;
    if (isOptimistic) msgEl.dataset.tempId = m.tempId;

    let avatarHtml = '';
    if (!isSent) {
      if (m.sender_avatar) {
        avatarHtml = `<img src="${m.sender_avatar}" alt="" class="dm-avatar">`;
      } else {
        const initial = (m.sender_display_name || m.sender_username || '?').charAt(0).toUpperCase();
        avatarHtml = `<div class="dm-avatar dm-avatar-initial">${initial}</div>`;
      }
    }

    let replyHtml = '';
    if (m.reply_to_body) {
      replyHtml = `<div class="dm-reply-to muted">${escapeHtml(m.reply_to_body)}</div>`;
    }

    let attachHtml = '';
    if (m.image_path) {
      attachHtml += `<div class="dm-attach"><img src="${m.image_path}" alt="" class="dm-attach-img" loading="lazy" onclick="window.open(this.src)"></div>`;
    }
    if (m.file_path) {
      attachHtml += `<p class="dm-attach"><a href="${m.file_path}" target="_blank" rel="noopener" class="dm-attach-link">📎 Download attachment</a></p>`;
    }
    if (m.video_path) {
      attachHtml += `<div class="dm-attach"><video src="${m.video_path}" controls class="dm-attach-video"></video></div>`;
    }

    const timeStr = m.created_at_fmt || m.created_at || 'Just now';
    const statusIcon = isOptimistic ? ' <span class="msg-pending-icon" title="Sending...">⏳</span>' : '';

    let actionsHtml = '';
    if (!isOptimistic && m.id) {
      actionsHtml = `
        <div class="dm-actions">
          <button type="button" class="dm-action-btn reply-to-btn" data-message-id="${m.id}" data-reply-body="${escapeHtml(m.body || '')}">Reply</button>
          ${isSent ? `<button type="button" class="dm-action-btn dm-delete-btn" onclick="deleteChatMsg(${m.id})">Delete</button>` : ''}
        </div>
      `;
    }

    const senderDisplay = m.sender_display_name || m.sender_username;
    const senderMarkup = m.sender_display_name
      ? `<strong>${escapeHtml(senderDisplay)}</strong> <span class="muted" style="font-size:0.85em;font-weight:normal;">@${escapeHtml(m.sender_username)}</span>`
      : `@${escapeHtml(m.sender_username)}`;

    msgEl.innerHTML = `
      ${avatarHtml}
      <div class="dm-bubble">
        ${replyHtml}
        ${!isSent ? `<span class="dm-sender">${senderMarkup}</span>` : ''}
        ${m.body ? `<p class="dm-body">${escapeHtml(m.body)}</p>` : ''}
        ${attachHtml}
        <div class="dm-footer">
          <span class="dm-time muted">${timeStr}${statusIcon}</span>
          ${actionsHtml}
        </div>
      </div>
    `;
    return msgEl;
  }

  // --- Render Message Element in DOM ---
  function appendMessage(m, isOptimistic = false) {
    // Check if already in DOM
    if (m.id && feed.querySelector(`[data-message-id="${m.id}"]`)) return;

    // Check if this incoming message matches a pending optimistic message from current user
    if (!isOptimistic && (m.sender_id === currentUserId || m.sender_username === currentUsername)) {
      const tempEl = feed.querySelector('[data-temp-id]');
      if (tempEl) {
        tempEl.dataset.messageId = m.id;
        tempEl.removeAttribute('data-temp-id');
        const pending = tempEl.querySelector('.msg-pending-icon');
        if (pending) pending.remove();

        const footer = tempEl.querySelector('.dm-footer');
        if (footer && !footer.querySelector('.dm-actions')) {
          const actions = document.createElement('div');
          actions.className = 'dm-actions';
          actions.innerHTML = `
            <button type="button" class="dm-action-btn reply-to-btn" data-message-id="${m.id}" data-reply-body="${escapeHtml(m.body || '')}">Reply</button>
            <button type="button" class="dm-action-btn dm-delete-btn" onclick="deleteChatMsg(${m.id})">Delete</button>
          `;
          footer.appendChild(actions);
        }
        return;
      }
    }

    // Remove empty state if present
    const emptyEl = feed.querySelector('.conversation-empty');
    if (emptyEl) emptyEl.remove();

    const isSent = m.sender_id === currentUserId || m.sender_username === currentUsername;
    const msgEl = buildMessageElement(m, isOptimistic);

    // Hide typing indicator while inserting
    if (typingEl) typingEl.style.display = 'none';

    feed.appendChild(msgEl);

    // If incoming message from other user, play chime and handle scroll
    if (!isSent && !isOptimistic) {
      playIncomingChime();
      if (isNearBottom()) {
        scrollToBottom(true);
      } else {
        if (newMsgPill) newMsgPill.style.display = 'flex';
      }
    } else {
      scrollToBottom(true);
    }
  }

  // --- Partial Loading: Load Older Messages ---
  async function loadOlderMessages() {
    if (isLoadingOlder || allOlderLoaded) return;

    const firstMsgEl = feed.querySelector('.dm-message[data-message-id]');
    if (!firstMsgEl) return;
    const beforeId = firstMsgEl.dataset.messageId;

    isLoadingOlder = true;
    if (btnLoadMore) btnLoadMore.style.display = 'none';
    if (loadingOlderSpinner) loadingOlderSpinner.style.display = 'block';

    try {
      const res = await fetch(`/api/messages/${encodeURIComponent(otherUsername)}?before=${encodeURIComponent(beforeId)}&limit=50`);
      const data = await res.json();

      if (data && data.ok && Array.isArray(data.messages)) {
        if (!data.hasMore || data.messages.length === 0) {
          allOlderLoaded = true;
          if (loadMoreContainer) loadMoreContainer.style.display = 'none';
        } else {
          if (btnLoadMore) btnLoadMore.style.display = 'inline-block';
        }

        if (data.messages.length > 0) {
          const oldScrollHeight = feed.scrollHeight;
          const oldScrollTop = feed.scrollTop;

          const fragment = document.createDocumentFragment();
          data.messages.forEach(m => {
            if (!feed.querySelector(`[data-message-id="${m.id}"]`)) {
              const el = buildMessageElement(m, false);
              fragment.appendChild(el);
            }
          });

          firstMsgEl.parentNode.insertBefore(fragment, firstMsgEl);

          // Preserve exact viewport scroll offset
          const heightDiff = feed.scrollHeight - oldScrollHeight;
          feed.scrollTop = oldScrollTop + heightDiff;
        }
      }
    } catch (err) {
      console.error('Failed to load older messages:', err);
      if (btnLoadMore) btnLoadMore.style.display = 'inline-block';
    } finally {
      isLoadingOlder = false;
      if (loadingOlderSpinner) loadingOlderSpinner.style.display = 'none';
    }
  }

  if (btnLoadMore) {
    btnLoadMore.addEventListener('click', function(e) {
      e.preventDefault();
      loadOlderMessages();
    });
  }

  // --- Submitting Form Asynchronously (No Page Reload) ---
  form.addEventListener('submit', async function(e) {
    e.preventDefault();

    const bodyVal = (textarea.value || '').trim();
    const hasFiles = Array.from(fileInputs).some(i => i.files && i.files.length > 0);

    if (!bodyVal && !hasFiles) return;

    // Send typing stop
    notifyTyping(false);

    // Build FormData
    const formData = new FormData(form);

    // Create optimistic local message
    const tempId = 'temp_' + Date.now();
    const optimisticMsg = {
      tempId,
      sender_id: currentUserId,
      sender_username: currentUsername,
      body: bodyVal,
      reply_to_body: replyPreviewText && replyPreview && replyPreview.style.display !== 'none' ? replyPreviewText.textContent : null,
      created_at_fmt: 'Just now',
    };

    // If user attached local image, create preview blob
    const imgInput = form.querySelector('input[name="image"]');
    if (imgInput && imgInput.files && imgInput.files[0]) {
      optimisticMsg.image_path = URL.createObjectURL(imgInput.files[0]);
    }

    appendMessage(optimisticMsg, true);

    // Reset compose box immediately so user can continue chatting
    textarea.value = '';
    textarea.style.height = 'auto';
    if (replyToInput) replyToInput.value = '';
    if (replyPreview) replyPreview.style.display = 'none';
    if (previewTray) {
      previewTray.innerHTML = '';
      previewTray.style.display = 'none';
    }
    textarea.focus();

    try {
      if (sendBtn) sendBtn.disabled = true;
      const res = await fetch('/messages', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: formData,
      });

      // Clear actual file inputs after fetch body prepared
      fileInputs.forEach(i => { i.value = ''; });

      const data = await res.json();
      if (sendBtn) sendBtn.disabled = false;

      if (data && data.ok && data.message) {
        // Check if WebSocket already upgraded this message
        const alreadyExists = feed.querySelector(`[data-message-id="${data.message.id}"]`);
        const tempEl = feed.querySelector(`[data-temp-id="${tempId}"]`);

        if (alreadyExists && tempEl) {
          // If WS already inserted or upgraded it, remove temp
          tempEl.remove();
        } else if (tempEl) {
          tempEl.dataset.messageId = data.message.id;
          tempEl.removeAttribute('data-temp-id');
          const pending = tempEl.querySelector('.msg-pending-icon');
          if (pending) pending.remove();

          const footer = tempEl.querySelector('.dm-footer');
          if (footer && !footer.querySelector('.dm-actions')) {
            const actions = document.createElement('div');
            actions.className = 'dm-actions';
            actions.innerHTML = `
              <button type="button" class="dm-action-btn reply-to-btn" data-message-id="${data.message.id}" data-reply-body="${escapeHtml(data.message.body || '')}">Reply</button>
              <button type="button" class="dm-action-btn dm-delete-btn" onclick="deleteChatMsg(${data.message.id})">Delete</button>
            `;
            footer.appendChild(actions);
          }
        }
      }
    } catch (err) {
      if (sendBtn) sendBtn.disabled = false;
      const tempEl = feed.querySelector(`[data-temp-id="${tempId}"]`);
      if (tempEl) {
        const pending = tempEl.querySelector('.msg-pending-icon');
        if (pending) {
          pending.textContent = '⚠️ Failed';
          pending.style.color = '#ef4444';
        }
      }
    }
  });

  // --- Keyboard Shortcuts: Enter sends, Shift+Enter new line ---
  if (textarea) {
    textarea.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    });
  }

  // Global delete message helper
  window.deleteChatMsg = async function(id) {
    if (!confirm('Delete this message?')) return;
    try {
      const res = await fetch(`/messages/${id}/delete`, {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
      });
      const data = await res.json();
      if (data && data.ok) {
        handleRemoteDelete(id);
      }
    } catch (_) {}
  };

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
