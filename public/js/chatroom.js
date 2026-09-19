/**
 * ClassChat - Real-Time Chatroom Engine
 */
(function() {
  const feed = document.getElementById('message-feed');
  const form = document.getElementById('chatroom-form');
  const textarea = document.getElementById('msg-body');
  const sendBtn = document.getElementById('btn-send');
  const typingEl = document.getElementById('typing-indicator');
  const typingText = document.getElementById('typing-text');
  const replyToInput = document.getElementById('reply_to');
  const replyPreview = document.getElementById('reply-preview');
  const replyPreviewText = document.getElementById('reply-preview-text');
  const replyCancel = document.getElementById('reply-cancel');
  const previewTray = document.getElementById('compose-preview-tray');
  const newMsgPill = document.getElementById('new-message-pill');
  const loadMoreContainer = document.getElementById('load-more-container');
  const btnLoadMore = document.getElementById('btn-load-more');
  const loadingOlderSpinner = document.getElementById('loading-older-spinner');
  const emptyState = document.getElementById('room-empty-state');
  const roomTitleDisplay = document.getElementById('chatroom-title-display');

  if (!feed || !form) return;

  const roomId = Number(feed.dataset.roomId);
  const currentUsername = feed.dataset.currentUser;
  const currentUserId = Number(feed.dataset.currentUserId);
  const isStaff = feed.dataset.isStaff === '1';

  let ws = null;
  let wsReconnectTimer = null;
  let typingTimeout = null;
  let lastTypingSent = 0;
  let incomingTypingTimer = null;

  // --- Audio Chime via Web Audio API ---
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
    return feed.scrollHeight - feed.scrollTop - feed.clientHeight < 140;
  }

  function scrollToBottom(smooth) {
    if (smooth) {
      feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
    } else {
      feed.scrollTop = feed.scrollHeight;
    }
    if (newMsgPill) newMsgPill.style.display = 'none';
  }

  // Initial scroll to bottom
  scrollToBottom(false);

  if (newMsgPill) {
    newMsgPill.addEventListener('click', function() {
      scrollToBottom(true);
    });
  }

  feed.addEventListener('scroll', function() {
    if (isNearBottom() && newMsgPill) {
      newMsgPill.style.display = 'none';
    }
    if (feed.scrollTop < 40 && !isLoadingOlder && !allOlderLoaded) {
      loadOlderMessages();
    }
  });

  // --- Upward Infinite Scroll ---
  let isLoadingOlder = false;
  let allOlderLoaded = !loadMoreContainer || loadMoreContainer.style.display === 'none';

  function loadOlderMessages() {
    if (isLoadingOlder || allOlderLoaded) return;
    const firstMsg = feed.querySelector('.dm-message[data-message-id]');
    if (!firstMsg) return;
    const oldestId = Number(firstMsg.dataset.messageId);
    if (!oldestId) return;

    isLoadingOlder = true;
    if (loadingOlderSpinner) loadingOlderSpinner.style.display = 'inline-flex';
    if (btnLoadMore) btnLoadMore.style.display = 'none';

    const prevScrollHeight = feed.scrollHeight;
    const prevScrollTop = feed.scrollTop;

    fetch(`/api/chatrooms/${roomId}/messages?before=${oldestId}&limit=40`, { credentials: 'same-origin' })
      .then(r => r.json())
      .then(data => {
        isLoadingOlder = false;
        if (loadingOlderSpinner) loadingOlderSpinner.style.display = 'none';

        if (!data || !data.messages || data.messages.length === 0) {
          allOlderLoaded = true;
          if (loadMoreContainer) loadMoreContainer.style.display = 'none';
          return;
        }

        const fragment = document.createDocumentFragment();
        data.messages.forEach(m => {
          const msgEl = createMessageElement(m);
          fragment.appendChild(msgEl);
        });

        if (loadMoreContainer && loadMoreContainer.nextSibling) {
          feed.insertBefore(fragment, loadMoreContainer.nextSibling);
        } else {
          feed.prepend(fragment);
        }

        // Restore scroll position
        const heightDiff = feed.scrollHeight - prevScrollHeight;
        feed.scrollTop = prevScrollTop + heightDiff;

        if (!data.hasMore) {
          allOlderLoaded = true;
          if (loadMoreContainer) loadMoreContainer.style.display = 'none';
        } else {
          if (btnLoadMore) btnLoadMore.style.display = 'inline-block';
        }
      })
      .catch(() => {
        isLoadingOlder = false;
        if (loadingOlderSpinner) loadingOlderSpinner.style.display = 'none';
        if (btnLoadMore) btnLoadMore.style.display = 'inline-block';
      });
  }

  if (btnLoadMore) {
    btnLoadMore.addEventListener('click', loadOlderMessages);
  }

  // --- HTML Builder for Message Element ---
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function createMessageElement(m) {
    const isSent = m.sender_id === currentUserId;
    const div = document.createElement('div');
    div.className = `dm-message ${isSent ? 'dm-sent' : 'dm-received'}`;
    div.dataset.messageId = m.id;

    let avatarHtml = '';
    if (!isSent) {
      const initial = (m.sender_display_name || m.sender_username || '?').charAt(0).toUpperCase();
      avatarHtml = `
        <a href="/u/${escapeHtml(m.sender_username)}" class="message-user-avatar-link">
          ${m.sender_avatar ? `<img src="${escapeHtml(m.sender_avatar)}" alt="" class="dm-avatar">` : `<div class="dm-avatar dm-avatar-initial">${initial}</div>`}
        </a>
      `;
    }

    let replyHtml = '';
    if (m.reply_to_body) {
      replyHtml = `<div class="dm-reply-to muted">${escapeHtml(m.reply_to_body)}${m.reply_to_body.length >= 100 ? '…' : ''}</div>`;
    }

    let senderHeader = '';
    if (!isSent) {
      senderHeader = `
        <span class="dm-sender">
          <strong>${escapeHtml(m.sender_display_name || m.sender_username)}</strong>
          <span class="muted" style="font-size: 0.85em; font-weight: normal;">@${escapeHtml(m.sender_username)}</span>
        </span>
      `;
    }

    let bodyHtml = m.body ? `<p class="dm-body">${escapeHtml(m.body)}</p>` : '';
    let imageHtml = m.image_path ? `<div class="dm-attach"><img src="${escapeHtml(m.image_path)}" alt="" class="dm-attach-img" loading="lazy"></div>` : '';
    let fileHtml = m.file_path ? `<p class="dm-attach"><a href="${escapeHtml(m.file_path)}" target="_blank" rel="noopener" class="dm-attach-link">📎 Download attachment</a></p>` : '';
    let videoHtml = m.video_path ? `<div class="dm-attach"><video src="${escapeHtml(m.video_path)}" controls class="dm-attach-video"></video></div>` : '';

    const canDelete = isSent || isStaff;
    const deleteBtn = canDelete ? `<button type="button" class="dm-action-btn dm-delete-btn" onclick="deleteRoomMsg(${m.id})">Delete</button>` : '';

    const replyBodySnippet = (m.body || '').slice(0, 50).replace(/"/g, '&quot;');

    div.innerHTML = `
      ${avatarHtml}
      <div class="dm-bubble">
        ${replyHtml}
        ${senderHeader}
        ${bodyHtml}
        ${imageHtml}
        ${fileHtml}
        ${videoHtml}
        <div class="dm-footer">
          <span class="dm-time muted">${escapeHtml(m.created_at_fmt || m.created_at || 'Just now')}</span>
          <div class="dm-actions">
            <button type="button" class="dm-action-btn reply-to-btn" data-message-id="${m.id}" data-reply-body="${escapeHtml(replyBodySnippet)}">Reply</button>
            ${deleteBtn}
          </div>
        </div>
      </div>
    `;

    return div;
  }

  // --- Real-time WebSocket Connection ---
  function connectWs() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    fetch('/api/call/token', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(data => {
        if (!data || !data.token) return;
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(data.token)}`);

        ws.onopen = function() {
          if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
        };

        ws.onmessage = function(ev) {
          let msg;
          try { msg = JSON.parse(ev.data); } catch (_) { return; }

          // 1. Incoming Room Message
          if (msg.type === 'new_room_message' && msg.roomId === roomId && msg.message) {
            const m = msg.message;
            // Check if already in DOM (e.g. from optimistic send)
            if (feed.querySelector(`.dm-message[data-message-id="${m.id}"]`)) return;

            const nearBottom = isNearBottom();
            const msgEl = createMessageElement(m);

            if (emptyState) emptyState.style.display = 'none';
            feed.appendChild(msgEl);

            if (m.sender_id !== currentUserId) {
              playIncomingChime();
              if (nearBottom) {
                scrollToBottom(true);
              } else if (newMsgPill) {
                newMsgPill.style.display = 'inline-flex';
              }
            } else {
              scrollToBottom(true);
            }
            return;
          }

          // 2. Message Deletion
          if (msg.type === 'delete_room_message' && msg.roomId === roomId && msg.messageId) {
            const el = feed.querySelector(`.dm-message[data-message-id="${msg.messageId}"]`);
            if (el) {
              el.style.opacity = '0';
              el.style.transform = 'scale(0.95)';
              setTimeout(() => {
                el.remove();
                const remaining = feed.querySelectorAll('.dm-message[data-message-id]');
                if (remaining.length === 0 && emptyState) {
                  emptyState.style.display = 'block';
                }
              }, 200);
            }
            return;
          }

          // 3. Room Renamed
          if (msg.type === 'room_renamed' && msg.roomId === roomId && msg.newName) {
            if (roomTitleDisplay) roomTitleDisplay.textContent = msg.newName;
            document.title = `${msg.newName} — ClassChat`;
            const nameInput = document.getElementById('new-room-name');
            if (nameInput) nameInput.value = msg.newName;
            return;
          }

          // 4. Room Cleared
          if (msg.type === 'room_cleared' && msg.roomId === roomId) {
            const messages = feed.querySelectorAll('.dm-message[data-message-id]');
            messages.forEach(el => el.remove());
            if (emptyState) emptyState.style.display = 'block';
            if (loadMoreContainer) loadMoreContainer.style.display = 'none';
            return;
          }

          // 5. Room Typing
          if (msg.type === 'room_typing' && msg.roomId === roomId) {
            if (msg.fromUserId === currentUserId) return;
            if (msg.typing) {
              if (typingText) typingText.textContent = `${msg.fromDisplayName || msg.fromUsername} is typing...`;
              if (typingEl) typingEl.style.display = 'inline-flex';
              if (incomingTypingTimer) clearTimeout(incomingTypingTimer);
              incomingTypingTimer = setTimeout(() => {
                if (typingEl) typingEl.style.display = 'none';
              }, 3000);
            } else {
              if (typingEl) typingEl.style.display = 'none';
            }
            return;
          }
        };

        ws.onclose = function() {
          ws = null;
          if (!wsReconnectTimer) wsReconnectTimer = setTimeout(connectWs, 3000);
        };
      })
      .catch(() => {
        if (!wsReconnectTimer) wsReconnectTimer = setTimeout(connectWs, 3000);
      });
  }

  connectWs();

  // --- Typing Emission ---
  function sendTyping(isTyping) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'room_typing',
      roomId,
      typing: isTyping,
    }));
  }

  if (textarea) {
    textarea.addEventListener('input', function() {
      // Auto expand textarea height
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 140) + 'px';

      const now = Date.now();
      if (now - lastTypingSent > 2000) {
        lastTypingSent = now;
        sendTyping(true);
      }
      if (typingTimeout) clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        sendTyping(false);
      }, 2500);
    });

    textarea.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    });
  }

  // --- Reply System ---
  feed.addEventListener('click', function(e) {
    const btn = e.target.closest('.reply-to-btn');
    if (!btn) return;
    const msgId = btn.dataset.messageId;
    const replySnippet = btn.dataset.replyBody || 'message';

    if (replyToInput) replyToInput.value = msgId;
    if (replyPreviewText) replyPreviewText.textContent = replySnippet;
    if (replyPreview) replyPreview.style.display = 'flex';
    if (textarea) textarea.focus();
  });

  if (replyCancel) {
    replyCancel.addEventListener('click', function() {
      if (replyToInput) replyToInput.value = '';
      if (replyPreview) replyPreview.style.display = 'none';
    });
  }

  // --- File Attachments Preview ---
  const fileInputs = form.querySelectorAll('input[type="file"]');
  function updateFilePreview() {
    if (!previewTray) return;
    previewTray.innerHTML = '';
    let hasFiles = false;

    fileInputs.forEach(input => {
      if (input.files && input.files[0]) {
        hasFiles = true;
        const file = input.files[0];
        const chip = document.createElement('div');
        chip.className = 'preview-file-chip';
        chip.innerHTML = `
          <span>📎 ${escapeHtml(file.name)}</span>
          <button type="button" class="btn-ghost-sm preview-remove-btn">&times;</button>
        `;
        chip.querySelector('.preview-remove-btn').addEventListener('click', () => {
          input.value = '';
          updateFilePreview();
        });
        previewTray.appendChild(chip);
      }
    });

    previewTray.style.display = hasFiles ? 'flex' : 'none';
  }

  fileInputs.forEach(input => {
    input.addEventListener('change', updateFilePreview);
  });

  // --- Message Deletion ---
  window.deleteRoomMsg = function(msgId) {
    if (!confirm('Delete this message?')) return;
    fetch(`/chatrooms/${roomId}/messages/${msgId}/delete`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then(r => r.json())
      .then(data => {
        if (data && data.ok) {
          const el = feed.querySelector(`.dm-message[data-message-id="${msgId}"]`);
          if (el) el.remove();
          const remaining = feed.querySelectorAll('.dm-message[data-message-id]');
          if (remaining.length === 0 && emptyState) emptyState.style.display = 'block';
        }
      })
      .catch(() => {});
  };

  // --- Form Submission via AJAX ---
  let isSending = false;
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    if (isSending) return;

    const bodyText = (textarea ? textarea.value : '').trim();
    let hasFiles = false;
    fileInputs.forEach(i => { if (i.files && i.files.length > 0) hasFiles = true; });

    if (!bodyText && !hasFiles) return;

    isSending = true;
    if (sendBtn) sendBtn.disabled = true;

    const formData = new FormData(form);

    fetch(`/chatrooms/${roomId}/messages`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData,
      credentials: 'same-origin',
    })
      .then(r => r.json())
      .then(data => {
        isSending = false;
        if (sendBtn) sendBtn.disabled = false;

        if (data && data.ok && data.message) {
          const m = data.message;
          if (!feed.querySelector(`.dm-message[data-message-id="${m.id}"]`)) {
            const msgEl = createMessageElement(m);
            if (emptyState) emptyState.style.display = 'none';
            feed.appendChild(msgEl);
            scrollToBottom(true);
          }

          // Reset inputs
          if (textarea) {
            textarea.value = '';
            textarea.style.height = 'auto';
          }
          if (replyToInput) replyToInput.value = '';
          if (replyPreview) replyPreview.style.display = 'none';
          fileInputs.forEach(i => { i.value = ''; });
          updateFilePreview();
          sendTyping(false);
        } else {
          // Fallback reload if unexpected response
          form.submit();
        }
      })
      .catch(() => {
        isSending = false;
        if (sendBtn) sendBtn.disabled = false;
        form.submit();
      });
  });

  // --- Modals Toggle Logic ---
  function setupModal(openBtnId, modalId, closeBtnId, cancelBtnId, okBtnId) {
    const modal = document.getElementById(modalId);
    const openBtn = document.getElementById(openBtnId);
    const closeBtn = document.getElementById(closeBtnId);
    const cancelBtn = document.getElementById(cancelBtnId);
    const okBtn = document.getElementById(okBtnId);

    if (!modal) return;

    function open() { modal.style.display = 'flex'; }
    function close() { modal.style.display = 'none'; }

    if (openBtn) openBtn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (cancelBtn) cancelBtn.addEventListener('click', close);
    if (okBtn) okBtn.addEventListener('click', close);

    modal.addEventListener('click', function(e) {
      if (e.target === modal) close();
    });
  }

  setupModal('btn-open-rename', 'rename-modal', 'btn-close-rename-modal', 'btn-cancel-rename-modal');
  setupModal('btn-open-invite', 'invite-modal', 'btn-close-invite-modal', 'btn-cancel-invite-modal', 'btn-close-invite-ok');
  setupModal('btn-open-members', 'members-modal', 'btn-close-members-modal', null, 'btn-close-members-ok');

  // --- AJAX Rename Submission ---
  const renameForm = document.getElementById('rename-form');
  if (renameForm) {
    renameForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const input = document.getElementById('new-room-name');
      const val = input ? input.value.trim() : '';
      if (!val) return;

      fetch(`/chatrooms/${roomId}/rename`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({ name: val }),
        credentials: 'same-origin',
      })
        .then(r => r.json())
        .then(data => {
          if (data && data.ok) {
            if (roomTitleDisplay) roomTitleDisplay.textContent = data.name;
            document.title = `${data.name} — ClassChat`;
            const renameModal = document.getElementById('rename-modal');
            if (renameModal) renameModal.style.display = 'none';
          } else {
            renameForm.submit();
          }
        })
        .catch(() => renameForm.submit());
    });
  }
})();
