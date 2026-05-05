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
          <span class="time">${c.last_message_at ? new Date(c.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
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
    
    return `
      <div class="message ${isSelf ? 'self' : 'other'}">
        <div class="content">${m.decryptedContent}</div>
        <div class="message-time">${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
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
