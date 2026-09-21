// ClassChat Plus — Real-time Modern Client Logic
(function() {
  const chatContainer = document.getElementById('plus-messages-container');
  const chatForm = document.getElementById('plus-chat-form');
  const chatInput = document.getElementById('plus-chat-input');
  const typingIndicator = document.getElementById('plus-typing-status');
  const activeServerId = window.__PLUS_SERVER_ID__ || null;
  const activeChannelId = window.__PLUS_CHANNEL_ID__ || null;
  const currentUserId = window.__PLUS_USER_ID__ || null;
  const isAdmin = !!window.__PLUS_IS_ADMIN__;

  // Auto-scroll to bottom of messages
  function scrollToBottom(smooth) {
    if (!chatContainer) return;
    if (smooth) {
      chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    } else {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  if (chatContainer) {
    scrollToBottom(false);
  }

  // --- WebSocket Real-Time Connection ---
  let socket = null;
  let typingTimer = null;
  let isTyping = false;

  function initWebSocket() {
    if (!activeServerId || !activeChannelId) return;

    fetch('/api/call/token', { credentials: 'same-origin' })
      .then(res => {
        if (!res.ok) throw new Error('Token fetch failed: ' + res.status);
        return res.json();
      })
      .then(data => {
        if (!data || !data.token) {
          console.warn('[Plus WS] No token returned from server');
          return;
        }
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(data.token)}`;
        socket = new WebSocket(wsUrl);

        socket.onopen = function() {
          console.log('[Plus WS] Connected to channel', activeChannelId);
        };

        socket.onmessage = function(event) {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'plus_message') {
              if (Number(data.channelId) === Number(activeChannelId)) {
                appendMessage(data.message);
                scrollToBottom(true);
              }
            } else if (data.type === 'plus_typing') {
              if (Number(data.channelId) === Number(activeChannelId) && Number(data.fromUserId) !== Number(currentUserId)) {
                handleTypingEvent(data);
              }
            } else if (data.type === 'plus_message_edit') {
              if (Number(data.channelId) === Number(activeChannelId)) {
                handleRemoteEdit(data);
              }
            } else if (data.type === 'plus_message_delete') {
              if (Number(data.channelId) === Number(activeChannelId)) {
                handleRemoteDelete(data.messageId);
              }
            } else if (data.type === 'plus_message_reaction') {
              if (Number(data.channelId) === Number(activeChannelId)) {
                handleRemoteReaction(data.messageId, data.reactions);
              }
            } else if (data.type === 'plus_message_pin') {
              if (Number(data.channelId) === Number(activeChannelId)) {
                handleRemotePin(data.messageId, data.is_pinned);
              }
            }
          } catch (e) {
            console.error('[Plus WS Error]', e);
          }
        };

        socket.onclose = function() {
          console.log('[Plus WS] Connection closed, reconnecting in 3s...');
          setTimeout(initWebSocket, 3000);
        };

        socket.onerror = function(err) {
          console.error('[Plus WS Socket Error]', err);
        };
      })
      .catch(err => {
        console.error('[Plus WS Token Error]', err);
        setTimeout(initWebSocket, 4000);
      });
  }

  // Typing event handler
  function handleTypingEvent(data) {
    if (!typingIndicator) return;
    if (data.typing) {
      const name = data.fromDisplayName || data.fromUsername || 'Someone';
      typingIndicator.innerHTML = `<span><strong>${escapeHtml(name)}</strong> is typing...</span>`;
      clearTimeout(window.__typingIndicatorTimeout);
      window.__typingIndicatorTimeout = setTimeout(() => {
        typingIndicator.textContent = '';
      }, 3500);
    } else {
      typingIndicator.textContent = '';
    }
  }

  function emitTyping(typing) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: 'plus_typing',
      serverId: activeServerId,
      channelId: activeChannelId,
      typing: !!typing,
    }));
  }

  // Handle Remote Message Edit
  function handleRemoteEdit(data) {
    const msgId = data.messageId;
    const bodyEl = document.getElementById(`plus-msg-body-${msgId}`);
    if (bodyEl && !bodyEl.querySelector('.plus-inline-edit-box')) {
      bodyEl.textContent = data.message ? data.message.body : (data.body || '');
    }
    const editedBadge = document.getElementById(`plus-msg-edited-${msgId}`);
    if (editedBadge) {
      editedBadge.style.display = 'inline-block';
    }
  }

  // Handle Remote Message Delete
  function handleRemoteDelete(msgId) {
    const row = document.querySelector(`[data-message-id="${msgId}"]`);
    if (row) {
      row.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      row.style.opacity = '0';
      row.style.transform = 'translateY(-6px)';
      setTimeout(() => {
        row.remove();
      }, 200);
    }
  }

  // Handle Remote Reaction
  function handleRemoteReaction(msgId, reactions) {
    const reactionsContainer = document.getElementById(`plus-msg-reactions-${msgId}`);
    if (!reactionsContainer) return;

    reactionsContainer.innerHTML = '';
    if (!reactions || !reactions.length) return;

    reactions.forEach(r => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `plus-reaction-badge ${r.hasReacted ? 'active' : ''}`;
      btn.setAttribute('data-emoji', r.emoji);
      btn.title = r.userList || '';
      btn.onclick = () => window.toggleMessageReaction(msgId, r.emoji);
      btn.innerHTML = `<span class="reaction-emoji">${r.emoji}</span> <span class="reaction-count">${r.count}</span>`;
      reactionsContainer.appendChild(btn);
    });
  }

  // Handle Remote Message Pin
  function handleRemotePin(messageId, isPinned) {
    const row = document.getElementById(`msg-row-${messageId}`) || document.querySelector(`[data-message-id="${messageId}"]`);
    if (row) {
      if (isPinned) {
        row.classList.add('is-pinned-row');
      } else {
        row.classList.remove('is-pinned-row');
      }
    }
    const tag = document.getElementById(`plus-pinned-tag-${messageId}`);
    if (tag) {
      tag.style.display = isPinned ? 'inline-flex' : 'none';
    }
    const pinBtn = document.getElementById(`pin-btn-${messageId}`);
    if (pinBtn) {
      if (isPinned) {
        pinBtn.classList.add('pinned-active');
        pinBtn.title = 'Unpin Message';
      } else {
        pinBtn.classList.remove('pinned-active');
        pinBtn.title = 'Pin Message';
      }
    }
    const modal = document.getElementById('pinned-messages-modal');
    if (modal && modal.style.display === 'flex') {
      loadPinnedMessages();
    }
  }

  // Escape HTML helper
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // Append new message to chat UI
  function appendMessage(msg) {
    if (!chatContainer) return;
    if (document.querySelector(`[data-message-id="${msg.id}"]`)) return;

    // Determine grouping with the previous message row
    const lastRow = chatContainer.querySelector('.plus-message-row:last-child');
    let isGrouped = false;
    if (lastRow) {
      const lastSenderId = lastRow.getAttribute('data-sender-id');
      if (lastSenderId && Number(lastSenderId) === Number(msg.sender_id)) {
        isGrouped = true;
      }
    }

    const isAuthor = Number(currentUserId) === Number(msg.sender_id);
    const canDelete = isAuthor || isAdmin;
    const isPinned = !!msg.is_pinned;

    const row = document.createElement('div');
    row.className = `plus-message-row ${isGrouped ? 'grouped' : ''} ${isPinned ? 'is-pinned-row' : ''}`;
    row.setAttribute('data-message-id', msg.id);
    row.setAttribute('data-sender-id', msg.sender_id);
    row.id = `msg-row-${msg.id}`;

    const displayName = escapeHtml(msg.display_name || msg.username || '?');
    const username = escapeHtml(msg.username || '');
    const initial = (msg.display_name || msg.username || '?').charAt(0).toUpperCase();
    const role = (isAdmin ? 'admin' : 'member');

    let avatarHtml = '';
    if (!isGrouped) {
      avatarHtml = `
        <div class="plus-msg-avatar" onclick="window.openMemberCard(${msg.sender_id}, '${username}', '${displayName.replace(/'/g, "\\'")}', '${msg.avatar_path || ''}', '${role}')" style="cursor:pointer;" title="View Mini Profile">
          ${msg.avatar_path ? `<img src="${msg.avatar_path}" alt="" loading="lazy">` : `<div class="avatar-fallback">${initial}</div>`}
        </div>
      `;
    } else {
      avatarHtml = `
        <div class="plus-msg-grouped-time" title="${msg.created_at_fmt || ''}">
          ${(msg.created_at_fmt || '').split(' ')[0]}
        </div>
      `;
    }

    let attachmentHtml = '';
    if (msg.attachment_path) {
      if (msg.attachment_type === 'image') {
        attachmentHtml = `
          <div class="plus-msg-attachment">
            <a href="${msg.attachment_path}" target="_blank" class="plus-image-link">
              <img src="${msg.attachment_path}" alt="attachment" loading="lazy">
            </a>
          </div>
        `;
      } else {
        const fname = escapeHtml(msg.attachment_path.split('/').pop());
        attachmentHtml = `
          <div class="plus-msg-attachment">
            <div class="plus-file-card">
              <div class="plus-file-icon">📎</div>
              <div class="plus-file-info">
                <a href="${msg.attachment_path}" target="_blank" class="plus-file-name" download>${fname}</a>
              </div>
            </div>
          </div>
        `;
      }
    }

    let actionsHtml = `
      <div class="plus-msg-actions">
        <div class="plus-quick-emojis">
          <button type="button" class="plus-action-btn" title="React with Heart" onclick="window.toggleMessageReaction(${msg.id}, '❤️')">❤️</button>
          <button type="button" class="plus-action-btn" title="React with Joy" onclick="window.toggleMessageReaction(${msg.id}, '😂')">😂</button>
          <button type="button" class="plus-action-btn" title="React with Thumbs Up" onclick="window.toggleMessageReaction(${msg.id}, '👍')">👍</button>
          <button type="button" class="plus-action-btn" title="React with Fire" onclick="window.toggleMessageReaction(${msg.id}, '🔥')">🔥</button>
          <button type="button" class="plus-action-btn" title="React with Skull" onclick="window.toggleMessageReaction(${msg.id}, '💀')">💀</button>
        </div>
        <div class="plus-action-divider"></div>
        <button type="button" class="plus-action-btn" title="Copy Text" onclick="window.copyMessageText(${msg.id}, this)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
        ${isAdmin ? `
          <button type="button" class="plus-action-btn ${isPinned ? 'pinned-active' : ''}" id="pin-btn-${msg.id}" title="${isPinned ? 'Unpin Message' : 'Pin Message'}" onclick="window.togglePinMessage(${msg.id})">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>
          </button>
        ` : ''}
        ${isAuthor ? `
          <button type="button" class="plus-action-btn" title="Edit Message" onclick="window.startEditingMessage(${msg.id})">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          </button>
        ` : ''}
        ${canDelete ? `
          <button type="button" class="plus-action-btn danger" title="Delete Message" onclick="window.deleteMessage(${msg.id})">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        ` : ''}
      </div>
    `;

    row.innerHTML = `
      ${avatarHtml}
      <div class="plus-msg-content">
        ${!isGrouped ? `
          <div class="plus-msg-header">
            <a href="javascript:void(0)" onclick="window.openMemberCard(${msg.sender_id}, '${username}', '${displayName.replace(/'/g, "\\'")}', '${msg.avatar_path || ''}', '${role}')" class="plus-msg-author">${displayName}</a>
            ${msg.is_staff ? '<span class="badge badge-staff" style="margin-left:4px; font-size:0.68rem; padding:1px 5px;">STAFF</span>' : ''}
            <span class="plus-msg-time">${escapeHtml(msg.created_at_fmt || '')}</span>
            <span class="plus-pinned-tag" id="plus-pinned-tag-${msg.id}" style="${isPinned ? '' : 'display:none;'}">📌 Pinned</span>
          </div>
        ` : ''}
        <div class="plus-msg-body" id="plus-msg-body-${msg.id}">${escapeHtml(msg.body)}</div>
        <span class="plus-msg-edited" id="plus-msg-edited-${msg.id}" style="${msg.edited_at ? '' : 'display:none;'}" title="Edited">(edited)</span>
        ${attachmentHtml}
        <div class="plus-msg-reactions" id="plus-msg-reactions-${msg.id}"></div>
      </div>
      ${actionsHtml}
    `;

    chatContainer.appendChild(row);
  }

  // --- Message Actions: Editing ---
  window.startEditingMessage = function(messageId) {
    const bodyEl = document.getElementById(`plus-msg-body-${messageId}`);
    if (!bodyEl) return;
    if (bodyEl.querySelector('.plus-inline-edit-box')) return;

    const originalText = bodyEl.textContent.trim();

    bodyEl.innerHTML = `
      <div class="plus-inline-edit-box">
        <textarea class="plus-inline-edit-textarea" rows="2">${escapeHtml(originalText)}</textarea>
        <div class="plus-inline-edit-footer">
          <span class="plus-inline-edit-hint">escape to <a href="javascript:void(0)" onclick="cancelEditMessage(${messageId}, '${escapeHtml(originalText).replace(/'/g, "\\'")}')">cancel</a> • enter to <a href="javascript:void(0)" onclick="saveEditMessage(${messageId})">save</a></span>
          <div class="plus-inline-edit-actions">
            <button type="button" class="btn btn-xs btn-ghost" onclick="cancelEditMessage(${messageId}, '${escapeHtml(originalText).replace(/'/g, "\\'")}')">Cancel</button>
            <button type="button" class="btn btn-xs btn-primary" onclick="saveEditMessage(${messageId})">Save</button>
          </div>
        </div>
      </div>
    `;

    const textarea = bodyEl.querySelector('textarea');
    if (textarea) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          saveEditMessage(messageId);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelEditMessage(messageId, originalText);
        }
      });
    }
  };

  window.cancelEditMessage = function(messageId, originalText) {
    const bodyEl = document.getElementById(`plus-msg-body-${messageId}`);
    if (bodyEl) {
      bodyEl.textContent = originalText;
    }
  };

  window.saveEditMessage = function(messageId) {
    const bodyEl = document.getElementById(`plus-msg-body-${messageId}`);
    if (!bodyEl) return;
    const textarea = bodyEl.querySelector('textarea');
    if (!textarea) return;
    const newBody = textarea.value.trim();
    if (!newBody) return;

    fetch(`/plus/server/${activeServerId}/channel/${activeChannelId}/message/${messageId}/edit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ body: newBody }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          bodyEl.textContent = newBody;
          const editedBadge = document.getElementById(`plus-msg-edited-${messageId}`);
          if (editedBadge) editedBadge.style.display = 'inline-block';
        } else {
          alert(data.error || 'Failed to edit message');
        }
      })
      .catch(() => {
        alert('Network error while editing message');
      });
  };

  // --- Message Actions: Deleting ---
  window.deleteMessage = function(messageId) {
    if (!confirm('Are you sure you want to delete this message?')) return;

    fetch(`/plus/server/${activeServerId}/channel/${activeChannelId}/message/${messageId}/delete`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
      },
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          handleRemoteDelete(messageId);
        } else {
          alert(data.error || 'Failed to delete message');
        }
      })
      .catch(() => {
        alert('Network error while deleting message');
      });
  };

  // --- Message Actions: Reactions ---
  window.toggleMessageReaction = function(messageId, emoji) {
    // If WebSocket is open, we can send via WS for instant reaction or HTTP
    fetch(`/plus/server/${activeServerId}/channel/${activeChannelId}/message/${messageId}/react`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ emoji }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.reactions) {
          handleRemoteReaction(messageId, data.reactions);
        }
      })
      .catch(() => {});
  };

  // --- QoL: Copy Message Text ---
  window.copyMessageText = function(messageId, btnEl) {
    const bodyEl = document.getElementById(`plus-msg-body-${messageId}`);
    if (!bodyEl) return;
    const text = bodyEl.textContent.trim();
    if (!text) return;

    function showFeedback() {
      if (!btnEl) return;
      const parent = btnEl.parentElement || btnEl;
      const existing = parent.querySelector('.plus-copied-toast');
      if (existing) existing.remove();

      const toast = document.createElement('span');
      toast.className = 'plus-copied-toast';
      toast.textContent = 'Copied!';
      parent.style.position = 'relative';
      parent.appendChild(toast);

      setTimeout(() => {
        toast.remove();
      }, 1500);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showFeedback).catch(() => {
        fallbackCopy(text, showFeedback);
      });
    } else {
      fallbackCopy(text, showFeedback);
    }
  };

  function fallbackCopy(text, cb) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      if (cb) cb();
    } catch (e) {}
    document.body.removeChild(ta);
  }

  // --- QoL: Toggle Pin Message ---
  window.togglePinMessage = function(messageId) {
    if (!activeServerId || !activeChannelId) return;

    fetch(`/plus/server/${activeServerId}/channel/${activeChannelId}/message/${messageId}/pin`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
      },
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          handleRemotePin(messageId, data.is_pinned);
        } else {
          alert(data.error || 'Failed to toggle pin');
        }
      })
      .catch(err => {
        console.error('[Pin Error]', err);
      });
  };

  // --- QoL: Pinned Messages Modal & Drawer ---
  window.openPinnedMessagesModal = function() {
    const modal = document.getElementById('pinned-messages-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    loadPinnedMessages();
  };

  function loadPinnedMessages() {
    const container = document.getElementById('plus-pinned-list');
    if (!container || !activeServerId || !activeChannelId) return;

    container.innerHTML = '<div class="plus-pinned-loading">Loading pinned messages...</div>';

    fetch(`/plus/server/${activeServerId}/channel/${activeChannelId}/pins`)
      .then(res => res.json())
      .then(data => {
        if (!data.success || !data.pins || data.pins.length === 0) {
          container.innerHTML = `
            <div class="plus-pinned-empty">
              <div class="plus-pinned-empty-icon">📌</div>
              <div class="plus-pinned-empty-title">No pinned messages yet</div>
              <div style="font-size:0.85rem;">Admins can pin important announcements, rules, or links to this channel.</div>
            </div>
          `;
          return;
        }

        container.innerHTML = '';
        data.pins.forEach(pin => {
          const item = document.createElement('div');
          item.className = 'plus-pinned-item';
          const authorName = escapeHtml(pin.display_name || pin.username || 'User');
          const initial = (pin.display_name || pin.username || '?').charAt(0).toUpperCase();
          const avatarHtml = pin.avatar_path
            ? `<img src="${pin.avatar_path}" alt="" loading="lazy">`
            : `<div class="avatar-fallback">${initial}</div>`;

          item.innerHTML = `
            <div class="plus-pinned-item-header">
              <div class="plus-pinned-item-user">
                ${avatarHtml}
                <span class="plus-pinned-item-name">${authorName}</span>
              </div>
              <span class="plus-pinned-item-time">${escapeHtml(pin.created_at_fmt || '')}</span>
            </div>
            <div class="plus-pinned-item-body">${escapeHtml(pin.body)}</div>
            <div class="plus-pinned-item-actions">
              ${isAdmin ? `
                <button type="button" class="plus-pinned-unpin-btn" onclick="window.togglePinMessage(${pin.id})">
                  Unpin
                </button>
              ` : ''}
              <button type="button" class="plus-pinned-jump-btn" onclick="window.jumpToMessage(${pin.id})">
                Jump to message →
              </button>
            </div>
          `;
          container.appendChild(item);
        });
      })
      .catch(err => {
        container.innerHTML = '<div class="plus-pinned-empty">Failed to load pinned messages.</div>';
      });
  }

  window.jumpToMessage = function(messageId) {
    const modal = document.getElementById('pinned-messages-modal');
    if (modal) modal.style.display = 'none';

    const searchDropdown = document.getElementById('plus-search-results-dropdown');
    if (searchDropdown) searchDropdown.style.display = 'none';

    const row = document.getElementById(`msg-row-${messageId}`) || document.querySelector(`[data-message-id="${messageId}"]`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.remove('plus-message-highlight');
      void row.offsetWidth;
      row.classList.add('plus-message-highlight');
    } else {
      alert('Message not currently loaded in recent chat view.');
    }
  };

  // --- QoL: Member Mini-Profile Card ---
  window.openMemberCard = function(userId, username, displayName, avatarPath, role, isOnline) {
    const modal = document.getElementById('member-card-modal');
    if (!modal) return;

    const avatarContainer = document.getElementById('card-avatar-container');
    const nameEl = document.getElementById('card-display-name');
    const handleEl = document.getElementById('card-username');
    const roleBadge = document.getElementById('card-role-badge');
    const onlineDot = document.getElementById('card-online-dot');
    const dmLink = document.getElementById('card-dm-link');
    const profileLink = document.getElementById('card-profile-link');

    const cleanDisplayName = displayName || username || 'User';
    const cleanUsername = username || '';

    if (nameEl) nameEl.textContent = cleanDisplayName;
    if (handleEl) handleEl.textContent = '@' + cleanUsername;

    if (avatarContainer) {
      if (avatarPath) {
        avatarContainer.innerHTML = `<img src="${avatarPath}" alt="${cleanDisplayName}">`;
      } else {
        const initial = cleanDisplayName.charAt(0).toUpperCase();
        avatarContainer.innerHTML = `<div class="avatar-fallback">${initial}</div>`;
      }
    }

    if (roleBadge) {
      if (role === 'owner') {
        roleBadge.innerHTML = '👑 Server Owner';
        roleBadge.style.display = 'inline-flex';
      } else if (role === 'admin') {
        roleBadge.innerHTML = '🛡️ Server Admin';
        roleBadge.style.display = 'inline-flex';
      } else {
        roleBadge.innerHTML = 'Member';
        roleBadge.style.display = 'inline-flex';
      }
    }

    if (onlineDot) {
      if (isOnline === false) {
        onlineDot.classList.add('offline');
      } else {
        onlineDot.classList.remove('offline');
      }
    }

    if (dmLink) {
      if (Number(userId) === Number(currentUserId)) {
        dmLink.style.display = 'none';
      } else {
        dmLink.style.display = 'inline-flex';
        dmLink.href = `/messages/${encodeURIComponent(cleanUsername)}`;
      }
    }

    if (profileLink) {
      profileLink.href = `/u/${encodeURIComponent(cleanUsername)}`;
    }

    modal.style.display = 'flex';
  };

  // --- QoL: In-Channel Search ---
  let searchDebounceTimer = null;
  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  window.debounceChannelSearch = function(query) {
    clearTimeout(searchDebounceTimer);
    const dropdown = document.getElementById('plus-search-results-dropdown');
    if (!dropdown) return;

    const trimmed = (query || '').trim();
    if (!trimmed) {
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
      return;
    }

    searchDebounceTimer = setTimeout(() => {
      fetch(`/plus/server/${activeServerId}/channel/${activeChannelId}/search?q=${encodeURIComponent(trimmed)}`)
        .then(res => res.json())
        .then(data => {
          dropdown.style.display = 'block';
          if (!data.success || !data.results || data.results.length === 0) {
            dropdown.innerHTML = `<div class="plus-search-empty">No messages found matching "<strong>${escapeHtml(trimmed)}</strong>"</div>`;
            return;
          }

          dropdown.innerHTML = '';
          data.results.forEach(res => {
            const item = document.createElement('div');
            item.className = 'plus-search-result-item';
            const author = escapeHtml(res.display_name || res.username || 'User');
            const time = escapeHtml(res.created_at_fmt || '');

            let bodyHtml = escapeHtml(res.body);
            try {
              const regex = new RegExp(`(${escapeRegex(trimmed)})`, 'gi');
              bodyHtml = bodyHtml.replace(regex, '<mark class="plus-search-highlight">$1</mark>');
            } catch (e) {}

            item.innerHTML = `
              <div class="plus-search-result-header">
                <span class="plus-search-result-author">${author}</span>
                <span class="plus-search-result-time">${time}</span>
              </div>
              <div class="plus-search-result-body">${bodyHtml}</div>
            `;
            item.onclick = () => window.jumpToMessage(res.id);
            dropdown.appendChild(item);
          });
        })
        .catch(() => {
          dropdown.style.display = 'block';
          dropdown.innerHTML = '<div class="plus-search-empty">Failed to search messages</div>';
        });
    }, 250);
  };

  // Close search dropdown when clicking outside
  document.addEventListener('click', function(e) {
    const searchWrap = document.querySelector('.plus-search-box-wrap');
    const dropdown = document.getElementById('plus-search-results-dropdown');
    if (dropdown && searchWrap && !searchWrap.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  // --- Mobile Drawer Controls ---
  window.togglePlusDrawer = function(drawerType) {
    const backdrop = document.getElementById('plus-drawer-backdrop');
    const channelsSidebar = document.getElementById('plus-channels-sidebar');
    const membersSidebar = document.getElementById('plus-members-sidebar');

    if (drawerType === 'channels') {
      if (membersSidebar) membersSidebar.classList.remove('open');
      if (channelsSidebar) {
        const isOpen = channelsSidebar.classList.toggle('open');
        if (backdrop) backdrop.style.display = isOpen ? 'block' : 'none';
      }
    } else if (drawerType === 'members') {
      if (channelsSidebar) channelsSidebar.classList.remove('open');
      if (membersSidebar) {
        const isOpen = membersSidebar.classList.toggle('open');
        if (backdrop) backdrop.style.display = isOpen ? 'block' : 'none';
      }
    }
  };

  window.closeAllPlusDrawers = function() {
    const backdrop = document.getElementById('plus-drawer-backdrop');
    const channelsSidebar = document.getElementById('plus-channels-sidebar');
    const membersSidebar = document.getElementById('plus-members-sidebar');
    if (channelsSidebar) channelsSidebar.classList.remove('open');
    if (membersSidebar) membersSidebar.classList.remove('open');
    if (backdrop) backdrop.style.display = 'none';
  };

  // --- Typing Indicator Handler ---
  if (chatInput) {
    chatInput.addEventListener('input', function() {
      // Auto-resize textarea height
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';

      if (!isTyping) {
        isTyping = true;
        emitTyping(true);
      }
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        isTyping = false;
        emitTyping(false);
      }, 2500);
    });

    chatInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (chatForm) {
          chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
        }
      }
    });
  }

  // --- Form Submission via AJAX ---
  if (chatForm) {
    chatForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const body = (chatInput ? chatInput.value : '').trim();
      const fileInput = document.getElementById('plus-file-input');
      const hasFile = fileInput && fileInput.files && fileInput.files.length > 0;

      if (!body && !hasFile) return;

      const formData = new FormData(chatForm);

      // Clear input fields immediately for snappy responsiveness
      if (chatInput) {
        chatInput.value = '';
        chatInput.style.height = 'auto';
      }
      const preview = document.getElementById('plus-attachment-preview');
      if (preview) preview.style.display = 'none';

      clearTimeout(typingTimer);
      if (isTyping) {
        isTyping = false;
        emitTyping(false);
      }

      fetch(chatForm.action, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
        },
        body: formData,
      })
        .then(res => res.json())
        .then(data => {
          if (data.success && data.message) {
            appendMessage(data.message);
            scrollToBottom(true);
          }
          if (fileInput) fileInput.value = '';
        })
        .catch(err => {
          console.error('[Send Error]', err);
          if (fileInput) fileInput.value = '';
        });
    });
  }

  // --- Global Modal Controls ---
  window.openPlusModal = function(id) {
    const m = document.getElementById(id);
    if (m) {
      m.style.display = 'flex';
    } else if (id === 'create-server-modal') {
      window.location.href = '/plus/create';
    }
  };

  window.closePlusModal = function(id) {
    const m = document.getElementById(id);
    if (m) {
      m.style.display = 'none';
    }
  };

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.plus-modal-overlay').forEach(m => {
        if (m.style.display === 'flex' || m.style.display === 'block') {
          m.style.display = 'none';
        }
      });
      const searchDropdown = document.getElementById('plus-search-results-dropdown');
      if (searchDropdown) searchDropdown.style.display = 'none';
    }
  });

  // Initialize
  initWebSocket();
})();

