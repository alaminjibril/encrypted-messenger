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
const currentUserEmail = document.getElementById('currentUserEmail');
const userAvatar = document.getElementById('userAvatar');
const logoutBtn = document.getElementById('logoutBtn');

let currentRecipient = null;
let localMessages = [];
let privateKeyObject = null;
let myPublicKey = null;
let lastSearchResults = [];
const userId = localStorage.getItem('userId');

async function init() {
  if (!userId) {
    window.location.href = '/src/pages/auth.html';
    return;
  }

  currentUserEmail.textContent = localStorage.getItem('username');
  userAvatar.textContent = localStorage.getItem('username')[0].toUpperCase();

  try {
    // 1. Get Me (contains our public key)
    const me = await fetchMe();
    myPublicKey = me.public_key;

    // 2. Restore Private Key
    const wrappedKey = await getPrivateKey(userId);
    const salt = localStorage.getItem('pbkdf2Salt');
    const password = localStorage.getItem('sessionPassword');
    
    if (wrappedKey && salt && password) {
      privateKeyObject = await unwrapPrivateKey(wrappedKey, password, salt);
      console.log('Security: Private key restored to memory');
    } else {
      throw new Error('Security credentials missing. Please log in again.');
    }

    await refreshChat();
    setInterval(refreshChat, 10000); // Poll for updates
  } catch (err) {
    console.error(err);
    alert(err.message);
    window.location.href = '/src/pages/auth.html';
  }
}

async function refreshChat() {
  try {
    const convos = await fetchConversations();
    
    // Cache conversation users so selectRecipient can find them
    convos.forEach(c => {
      if (!lastSearchResults.find(u => u.id === c.user_id)) {
        lastSearchResults.push({
          id: c.user_id,
          username: c.username,
          display_name: c.display_name
        });
      }
    });

    const convosChanged = JSON.stringify(convos) !== conversationsList.dataset.lastData;
    if (convosChanged) {
      renderConversations(convos);
      conversationsList.dataset.lastData = JSON.stringify(convos);
    }

    if (currentRecipient) {
      const history = await fetchConversationHistory(currentRecipient.id);
      
      // Decrypt messages on the fly
      for (const msg of history) {
        if (!msg.decryptedContent) {
          try {
            msg.decryptedContent = await decryptHybrid(msg.payload, privateKeyObject);
          } catch (e) {
            msg.decryptedContent = "[Unable to decrypt]";
          }
        }
      }
      
      const historyChanged = JSON.stringify(history) !== messagesViewport.dataset.lastData;
      if (historyChanged) {
        localMessages = history;
        renderMessages();
        messagesViewport.dataset.lastData = JSON.stringify(history);
      }
    }
  } catch (err) {
    console.error('Refresh failed:', err);
  }
}

function renderConversations(convos) {
  if (convos.length === 0) {
    conversationsList.innerHTML = '<div class="list-placeholder"><p>No conversations yet</p></div>';
    return;
  }

  conversationsList.innerHTML = convos.map(c => `
    <div class="conversation-item ${currentRecipient?.id === c.user_id ? 'active' : ''}" data-id="${c.user_id}">
      <div class="avatar">${c.username[0].toUpperCase()}</div>
      <div class="conversation-info">
        <h4>${c.display_name || c.username}</h4>
        <p class="last-msg">Active thread</p>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.conversation-item').forEach(item => {
    item.addEventListener('click', () => selectRecipient(item.dataset.id));
  });
}

async function selectRecipient(recipientId) {
  try {
    // 1. Find user in search results or current conversations
    let user = lastSearchResults.find(u => u.id === recipientId);
    
    // 2. Get their public key specifically
    const publicKey = await fetchPublicKey(recipientId);
    
    // 3. Create recipient object
    currentRecipient = { 
      id: recipientId, 
      public_key: publicKey,
      username: user ? user.username : (user?.display_name || 'User'),
      display_name: user ? user.display_name : null
    };
    
    noChatSelected.classList.add('hidden');
    chatActive.classList.remove('hidden');
    
    activeChatUser.textContent = currentRecipient.display_name || currentRecipient.username;
    activeChatAvatar.textContent = activeChatUser.textContent[0].toUpperCase();
    
    // Enable send button if there's already text
    sendMessageBtn.disabled = !messageInput.value.trim();
    
    await refreshChat();
  } catch (err) {
    console.error('Failed to select user:', err);
  }
}

function renderMessages() {
  messagesViewport.innerHTML = localMessages.slice().reverse().map(m => `
    <div class="message ${m.from_user_id === userId ? 'sent' : 'received'}">
      <div class="message-bubble">
        ${m.decryptedContent}
      </div>
      <div class="message-time">${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
    </div>
  `).join('');

  messagesViewport.scrollTop = messagesViewport.scrollHeight;
}

// User Search
let searchTimeout;
userSearch.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const query = e.target.value.trim();
  if (!query) {
    refreshChat();
    return;
  }

  searchTimeout = setTimeout(async () => {
    try {
      const results = await searchUsers(query);
      lastSearchResults = results;
      conversationsList.innerHTML = results.map(u => `
        <div class="conversation-item" data-id="${u.id}">
          <div class="avatar">${u.username[0].toUpperCase()}</div>
          <div class="conversation-info">
            <h4>${u.display_name || u.username}</h4>
            <p class="last-msg">Click to start secure chat</p>
          </div>
        </div>
      `).join('');

      document.querySelectorAll('.conversation-item').forEach(item => {
        item.addEventListener('click', () => selectRecipient(item.dataset.id));
      });
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
    
    // 1. Encrypt using Hybrid scheme
    const payload = await encryptHybrid(content, currentRecipient.public_key, myPublicKey);
    
    // 2. Send
    await sendMessage(currentRecipient.id, payload);
    
    messageInput.value = '';
    await refreshChat();
  } catch (err) {
    alert('Send failed: ' + err.message);
  } finally {
    sendMessageBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', () => {
  localStorage.clear();
  window.location.href = '/src/pages/auth.html';
});

init();
