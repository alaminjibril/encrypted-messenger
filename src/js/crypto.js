
export async function generateKeyPair() {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true, // Must be extractable for wrapping
    ['encrypt', 'decrypt']
  );

  return keyPair;
}

export async function wrapPrivateKey(privateKey, password, salt) {
  // 1. Derive a key from password using PBKDF2
  const passwordKey = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const wrappingKey = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );

  // We use AES-GCM with a fixed IV because the backend doesn't provide a slot for an IV
  const wrapped = await window.crypto.subtle.wrapKey(
    'pkcs8',
    privateKey,
    wrappingKey,
    { name: 'AES-GCM', iv: new Uint8Array(12) }
  );

  return arrayBufferToBase64(wrapped);
}

export async function unwrapPrivateKey(wrappedKeyBase64, password, saltBase64) {
  const salt = base64ToArrayBuffer(saltBase64);
  const wrappedKey = base64ToArrayBuffer(wrappedKeyBase64);

  // 1. Derive the same wrapping key
  const passwordKey = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const wrappingKey = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );

  // 2. Unwrap the private key
  const privateKey = await window.crypto.subtle.unwrapKey(
    'pkcs8',
    wrappedKey,
    wrappingKey,
    { name: 'AES-GCM', iv: new Uint8Array(12) },
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['decrypt']
  );

  return privateKey;
}

// --- Hybrid Encryption ---

export async function encryptHybrid(plaintext, recipientPublicKeyJwk, senderPublicKeyJwk) {
  // 1. Generate a random AES-GCM key and IV
  const aesKey = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt']
  );
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  // 2. Encrypt the plaintext with AES-GCM
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    encoded
  );

  // 3. Export AES key to encrypt it with RSA
  const rawAesKey = await window.crypto.subtle.exportKey('raw', aesKey);

  // 4. Import RSA Public Keys
  const rsaRecipient = await importPublicKey(recipientPublicKeyJwk);
  const rsaSender = await importPublicKey(senderPublicKeyJwk);

  // 5. Encrypt AES key with both RSA keys
  const encryptedKey = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    rsaRecipient,
    rawAesKey
  );
  const encryptedKeyForSelf = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    rsaSender,
    rawAesKey
  );

  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv),
    encryptedKey: arrayBufferToBase64(encryptedKey),
    encryptedKeyForSelf: arrayBufferToBase64(encryptedKeyForSelf)
  };
}

export async function decryptHybrid(payload, privateKey) {
  const { ciphertext, iv, encryptedKey, encryptedKeyForSelf } = payload;
  
  // 1. Decrypt the AES key using RSA private key
  // We try encryptedKey first (if we are the recipient), then encryptedKeyForSelf (if we are the sender)
  let rawAesKey;
  try {
    rawAesKey = await window.crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      privateKey,
      base64ToArrayBuffer(encryptedKey)
    );
  } catch (e) {
    rawAesKey = await window.crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      privateKey,
      base64ToArrayBuffer(encryptedKeyForSelf)
    );
  }

  // 2. Import the AES key
  const aesKey = await window.crypto.subtle.importKey(
    'raw',
    rawAesKey,
    'AES-GCM',
    false,
    ['decrypt']
  );

  // 3. Decrypt the ciphertext
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToArrayBuffer(iv) },
    aesKey,
    base64ToArrayBuffer(ciphertext)
  );

  return new TextDecoder().decode(decrypted);
}

// --- Helpers ---

export async function importPublicKey(jwkOrPem) {
  const format = typeof jwkOrPem === 'string' && !jwkOrPem.startsWith('{') ? 'spki' : 'jwk';
  const keyData = format === 'jwk' ? JSON.parse(jwkOrPem) : base64ToArrayBuffer(jwkOrPem);
  
  return window.crypto.subtle.importKey(
    format,
    keyData,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt']
  );
}

export async function exportPublicKey(key) {
  const exported = await window.crypto.subtle.exportKey('spki', key);
  return arrayBufferToBase64(exported);
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
