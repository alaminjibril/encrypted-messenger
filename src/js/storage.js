// IndexedDB helpers for local storage of keys and messages

const DB_NAME = 'encrypted-messenger';
const DB_VERSION = 1;

export async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create stores
      if (!db.objectStoreNames.contains('keys')) {
        db.createObjectStore('keys', { keyPath: 'userId' });
      }

      if (!db.objectStoreNames.contains('messages')) {
        db.createObjectStore('messages', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'userId' });
      }
    };
  });
}

export async function getPrivateKey(userId) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('keys', 'readonly');
    const store = transaction.objectStore('keys');
    const request = store.get(userId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result?.privateKey);
  });
}

export async function savePrivateKey(userId, privateKey) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('keys', 'readwrite');
    const store = transaction.objectStore('keys');
    const request = store.put({ userId, privateKey, createdAt: new Date() });

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function saveMessage(message) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('messages', 'readwrite');
    const store = transaction.objectStore('messages');
    const request = store.put({ ...message, savedAt: new Date() });

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getLocalMessages() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('messages', 'readonly');
    const store = transaction.objectStore('messages');
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function saveUser(user) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('users', 'readwrite');
    const store = transaction.objectStore('users');
    const request = store.put(user);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getUser(userId) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('users', 'readonly');
    const store = transaction.objectStore('users');
    const request = store.get(userId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
