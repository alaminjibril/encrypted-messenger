import { fetchConversations, fetchConversationHistory, fetchPublicKey, fetchMe, sendMessage, searchUsers } from './api.js';
import { encryptHybrid, decryptHybrid, unwrapPrivateKey } from './crypto.js';
import { getPrivateKey, saveMessage, getLocalMessages } from './storage.js';

const conversationsList = document.getElementById('conversationsList');
const userSearch = document.getElementById('userSearch');
const chatActive = document.getElementById('chatActive');
const noChatSelected = document.getElementById('noChatSelected');
const activeChatUser = document.getElementById('activeChatUser');
const activeChatAvatar = document.getElementById('activeChatAvatar');
const messagesViewport = document.getElementById('messagesViewport');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userAvatar = document.getElementById('userAvatar');

let currentRecipient = null;
let localMessages = [];
let privateKeyObject = null;
let myPublicKey = null;
let lastSearchResults = [];
// Retrieve userId fresh to avoid any stale data
let currentUserId = localStorage.getItem('userId');

async function init() {
  currentUserId = localStorage.getItem('userId');
  if (!currentUserId) {
    window.location.href = '/src/pages/auth.html';
    return;
  }

  try {
    // 1. Unwrap Private Key
    const password = localStorage.getItem('sessionPassword');
    const saltBase64 = localStorage.getItem('pbkdf2Salt');
    const wrappedKeyBase64 = await getPrivateKey(currentUserId);
    
    if (!wrappedKeyBase64 || !password || !saltBase64) {
      throw new Error('Encryption session lost');
    }

    privateKeyObject = await unwrapPrivateKey(wrappedKeyBase64, password, saltBase64);

    // 2. Initial Data Load
    const me = await fetchMe();
    myPublicKey = me.public_key;
    userAvatar.textContent = me.username[0].toUpperCase();
    
    await refreshChat();
    
    // 3. Poll for new messages
    setInterval(refreshChat, 5000);

  } catch (err) {
    console.error(err);
    alert('Session Error: ' + err.message);
    window.location.href = '/src/pages/auth.html';
  }
}

async function refreshChat() {
  try {
    const convos = await fetchConversations();
    
    // Update local cache of users for easy lookup
    convos.forEach(c => {
      if (!lastSearchResults.find(u => u.id === c.user_id)) {
        lastSearchResults.push({
          id: c.user_id,
          username: c.username,
          display_name: c.display_name
        });
      }
    });

    // Decrypt conversation previews
    const lastDataStr = conversationsList.dataset.lastData || "[]";
    const lastData = JSON.parse(lastDataStr);

    for (const c of convos) {
      if (c.last_message_payload) {
        try {
          const payload = typeof c.last_message_payload === 'string' ? JSON.parse(c.last_message_payload) : c.last_message_payload;
          c.decryptedPreview = await decryptHybrid(payload, privateKeyObject);
        } catch (e) {
          c.decryptedPreview = "🔒 Encrypted Message";
        }
      } else {
        // Fallback: fetch the last message from history to create a preview
        const oldConvo = lastData.find(old => old.user_id === c.user_id);
        if (oldConvo && oldConvo.decryptedPreview && oldConvo.last_message_at === c.last_message_at) {
          c.decryptedPreview = oldConvo.decryptedPreview; // Use cached preview
        } else {
          try {
            const history = await fetchConversationHistory(c.user_id);
            if (history && history.length > 0) {
              const latestMsg = history.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
              const payload = typeof latestMsg.payload === 'string' ? JSON.parse(latestMsg.payload) : latestMsg.payload;
              c.decryptedPreview = await decryptHybrid(payload, privateKeyObject);
            } else {
              c.decryptedPreview = "No messages yet";
            }
          } catch (err) {
            c.decryptedPreview = "🔒 Encrypted Message";
          }
        }
      }
    }

    const convosChanged = JSON.stringify(convos) !== conversationsList.dataset.lastData;
    if (convosChanged) {
      renderConversations(convos);
      conversationsList.dataset.lastData = JSON.stringify(convos);
    }

    if (currentRecipient) {
      const history = await fetchConversationHistory(currentRecipient.id);
      
      for (const msg of history) {
        if (!msg.decryptedContent) {
          try {
            // Ensure payload is an object
            const payload = typeof msg.payload === 'string' ? JSON.parse(msg.payload) : msg.payload;
            msg.decryptedContent = await decryptHybrid(payload, privateKeyObject);
          } catch (e) {
            console.error('Decryption failed for msg:', msg.id, e);
            msg.decryptedContent = "[Unable to decrypt]";
          }
        }
      }
      
      const historyChanged = JSON.stringify(history) !== messagesViewport.dataset.lastData;
      if (historyChanged) {
        // Ensure chronological order (oldest at top)
        const sortedHistory = [...history].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        localMessages = sortedHistory;
        renderMessages();
        messagesViewport.dataset.lastData = JSON.stringify(history);
      }
    }
  } catch (err) {
    console.error('Refresh failed:', err);
  }
}

function renderConversations(convos) {
  conversationsList.innerHTML = convos.map(c => {
    // Determine the preview text
    const previewText = c.decryptedPreview || "🔒 Encrypted Message";
    const unreadBadge = (c.unread_count && c.unread_count > 0) 
      ? `<span class="badge">${c.unread_count}</span>` 
      : '';

    return `
    <div class="conversation-item ${currentRecipient?.id === c.user_id ? 'active' : ''}" data-id="${c.user_id}">
      <div class="avatar">${c.username[0].toUpperCase()}</div>
      <div class="conversation-info">
        <div class="convo-header">
          <h4>${c.display_name || c.username}</h4>
          <span class="time ${c.unread_count > 0 ? 'unread-time' : ''}">${c.last_message_at ? new Date(c.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
        </div>
        <p class="last-msg">${previewText}</p>
      </div>
      ${unreadBadge}
    </div>
  `}).join('');

  document.querySelectorAll('.conversation-item').forEach(item => {
    item.addEventListener('click', () => selectRecipient(item.dataset.id));
  });
}

function renderMessages() {

  messagesViewport.innerHTML = localMessages.map(m => {
    // Robust sender ID detection
    const senderId = m.from_user_id || m.sender_id || m.sender || m.user_id || m.from;
    const isSelf = String(senderId) === String(currentUserId);

    // WhatsApp Ticks logic for sent messages
    let ticksHtml = '';
    if (isSelf) {
      if (m.read || m.is_read) {
        ticksHtml = `<span class="ticks read"><svg viewBox="0 0 16 15" width="16" height="15"><path fill="currentColor" d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.346.125.467-.025l6.236-8.033a.412.412 0 0 0-.011-.535zM11.536 3.32l-.478-.372a.365.365 0 0 0-.51.063L5.192 9.879a.32.32 0 0 1-.484.033L1.891 7.399a.366.366 0 0 0-.514.041l-.401.488a.418.418 0 0 0 .044.54l3.194 2.915c.144.14.348.125.469-.025l6.83-8.503a.413.413 0 0 0-.013-.535z"></path></svg></span>`;
      } else if (m.delivered) {
        ticksHtml = `<span class="ticks delivered"><svg viewBox="0 0 16 15" width="16" height="15"><path fill="currentColor" d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.346.125.467-.025l6.236-8.033a.412.412 0 0 0-.011-.535zM11.536 3.32l-.478-.372a.365.365 0 0 0-.51.063L5.192 9.879a.32.32 0 0 1-.484.033L1.891 7.399a.366.366 0 0 0-.514.041l-.401.488a.418.418 0 0 0 .044.54l3.194 2.915c.144.14.348.125.469-.025l6.83-8.503a.413.413 0 0 0-.013-.535z"></path></svg></span>`;
      } else {
        ticksHtml = `<span class="ticks sent"><svg viewBox="0 0 11 9" width="11" height="9"><path fill="currentColor" d="M3.5 7.6L1.1 5.2c-.3-.3-.8-.3-1.1 0-.3.3-.3.8 0 1.1l3 3c.1.1.3.2.5.2s.4-.1.5-.2l6-6c.3-.3.3-.8 0-1.1-.3-.3-.8-.3-1.1 0L3.5 7.6z"></path></svg></span>`;
      }
    }

    return `
      <div class="message ${isSelf ? 'self' : 'other'}">
        <div class="content">${m.decryptedContent}</div>
        <div class="message-meta">
          <span class="message-time">${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          ${ticksHtml}
        </div>
      </div>
    `;
  }).join('');
  messagesViewport.scrollTop = messagesViewport.scrollHeight;
}

async function selectRecipient(recipientId) {
  try {
    let user = lastSearchResults.find(u => u.id === recipientId);
    const publicKey = await fetchPublicKey(recipientId);
    
    currentRecipient = { 
      id: recipientId, 
      public_key: publicKey,
      username: user?.username || 'User',
      display_name: user?.display_name || null
    };

    // Update UI
    noChatSelected.classList.add('hidden');
    chatActive.classList.remove('hidden');
    activeChatUser.textContent = currentRecipient.display_name || currentRecipient.username;
    activeChatAvatar.textContent = activeChatUser.textContent[0].toUpperCase();

    // Mobile shell toggle
    document.querySelector('.app-shell').classList.add('chat-open');

    await refreshChat();
  } catch (err) {
    console.error('Failed to select user:', err);
  }
}

// Event Listeners
userSearch.addEventListener('input', (e) => {
  const query = e.target.value.trim();
  if (query.length < 3) return;

  clearTimeout(window.searchTimeout);
  window.searchTimeout = setTimeout(async () => {
    try {
      const results = await searchUsers(query);
      lastSearchResults = results;
      renderConversations(results.map(u => ({
        user_id: u.id,
        username: u.username,
        display_name: u.display_name,
        last_message_at: new Date(),
        unread_count: 0
      })));
    } catch (err) {
      console.error(err);
    }
  }, 500);
});

messageInput.addEventListener('input', () => {
  sendMessageBtn.disabled = !messageInput.value.trim() || !currentRecipient;
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault(); // Prevent default newline
    if (!sendMessageBtn.disabled) {
      sendMessageBtn.click();
    }
  }
});

sendMessageBtn.addEventListener('click', async () => {
  const content = messageInput.value.trim();
  if (!content || !currentRecipient) return;

  try {
    sendMessageBtn.disabled = true;
    const payload = await encryptHybrid(content, currentRecipient.public_key, myPublicKey);
    await sendMessage(currentRecipient.id, payload);
    messageInput.value = '';
    await refreshChat();
  } catch (err) {
    alert('Send failed: ' + err.message);
  } finally {
    sendMessageBtn.disabled = false;
  }
});

// Mobile back button
const mobileBackBtn = document.getElementById('mobileBackBtn');
if (mobileBackBtn) {
  mobileBackBtn.addEventListener('click', () => {
    document.querySelector('.app-shell').classList.remove('chat-open');
    currentRecipient = null;
  });
}

// Logout functionality
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.clear();
  window.location.href = '/src/pages/auth.html';
});

// Navigation functionality
document.getElementById('settingsBtn').addEventListener('click', () => {
  window.location.href = '/src/pages/settings.html';
});

init();
