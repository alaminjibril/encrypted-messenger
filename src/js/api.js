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
    const error = await response.json();
    throw new Error(Array.isArray(error.detail) ? error.detail[0].msg : (error.message || 'Signup failed'));
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
    const error = await response.json();
    throw new Error(error.detail || 'Invalid credentials');
  }

  return response.json();
}

export async function fetchMe() {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_BASE}/auth/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!response.ok) throw new Error('Session expired');
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
    const error = await response.json();
    throw new Error(error.detail || 'Failed to send message');
  }

  return response.json();
}

export async function fetchConversations() {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_BASE}/conversations`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!response.ok) throw new Error('Failed to fetch conversations');
  return response.json();
}

export async function fetchConversationHistory(userId, before = null) {
  const token = localStorage.getItem('token');
  let url = `${API_BASE}/conversations/${userId}/messages`;
  if (before) url += `?before=${encodeURIComponent(before)}`;

  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!response.ok) throw new Error('Failed to fetch history');
  return response.json();
}

export async function searchUsers(query) {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_BASE}/users/search?q=${encodeURIComponent(query)}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!response.ok) throw new Error('Search failed');
  return response.json();
}

export async function fetchPublicKey(userId) {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_BASE}/users/${userId}/public-key`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!response.ok) throw new Error('Public key not found');
  const data = await response.json();
  return data.public_key;
}
