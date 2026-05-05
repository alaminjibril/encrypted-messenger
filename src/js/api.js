// Backend API calls for authentication and messaging
// Matches the WhisperBox OpenAPI Specification

const API_BASE = import.meta.env.VITE_API_BASE || 'https://whisperbox.koyeb.app';

/**
 * Register a new user
 * @param {Object} payload { username, display_name, password, public_key, wrapped_private_key, pbkdf2_salt }
 */
export async function signup(payload) {
  const response = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    if (response.status === 409) {
      throw new Error('Username already taken. Please choose another one.');
    }
    const error = await response.json();
    let message = 'Registration failed.';
    
    if (Array.isArray(error.detail)) {
      message = error.detail[0].msg;
    } else if (typeof error.detail === 'string') {
      message = error.detail;
    }
    
    throw new Error(message);
  }

  return response.json();
}

export async function login(username, password) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid username or password.');
    }
    const error = await response.json();
    throw new Error(error.detail || 'Login failed. Please check your connection.');
  }

  return response.json();
}

export async function fetchMe() {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_BASE}/auth/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!response.ok) {
    if (response.status === 401) throw new Error('Session expired. Please log in again.');
    throw new Error('Could not fetch user profile.');
  }
  return response.json();
}

export async function sendMessage(to, payload) {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_BASE}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ to, payload })
  });

  if (!response.ok) {
    if (response.status === 404) throw new Error('Recipient user not found.');
    if (response.status === 400) throw new Error('Cannot send a message to yourself.');
    if (response.status === 401) throw new Error('Authentication failed. Please re-login.');
    
    const error = await response.json();
    throw new Error(error.detail || 'Failed to send message.');
  }

  return response.json();
}

export async function fetchConversations() {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_BASE}/conversations`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!response.ok) {
    if (response.status === 401) throw new Error('Authentication failed.');
    throw new Error('Failed to load conversations.');
  }
  return response.json();
}

export async function fetchConversationHistory(userId, before = null) {
  const token = localStorage.getItem('token');
  let url = `${API_BASE}/conversations/${userId}/messages`;
  if (before) url += `?before=${encodeURIComponent(before)}`;

  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!response.ok) {
    if (response.status === 404) throw new Error('Chat history not found.');
    throw new Error('Failed to load message history.');
  }
  return response.json();
}

export async function searchUsers(query) {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_BASE}/users/search?q=${encodeURIComponent(query)}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!response.ok) {
    if (response.status === 422) throw new Error('Search query is too short.');
    throw new Error('Search failed.');
  }
  return response.json();
}

export async function fetchPublicKey(userId) {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_BASE}/users/${userId}/public-key`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!response.ok) {
    if (response.status === 404) throw new Error('Could not find public key for this user.');
    throw new Error('Encryption key retrieval failed.');
  }
  const data = await response.json();
  return data.public_key;
}
