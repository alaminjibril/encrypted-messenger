
// KEY GENERATION
export async function generateKeyPair() {
  return await window.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['encrypt', 'decrypt']
  );
}

// PRIVATE KEY WRAP / UNWRAP
export async function wrapPrivateKey(privateKey, password, salt) {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const wrappingKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey']
  );

  // ⚠️ NOTE: Ideally IV should be random and stored
  const iv = new Uint8Array(12);

  const wrapped = await crypto.subtle.wrapKey(
    'pkcs8',
    privateKey,
    wrappingKey,
    { name: 'AES-GCM', iv }
  );

  return arrayBufferToBase64(wrapped);
}

export async function unwrapPrivateKey(wrappedKeyBase64, password, saltBase64) {
  const salt = base64ToArrayBuffer(saltBase64);
  const wrappedKey = base64ToArrayBuffer(wrappedKeyBase64);

  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const wrappingKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['unwrapKey']
  );

  return await crypto.subtle.unwrapKey(
    'pkcs8',
    wrappedKey,
    wrappingKey,
    { name: 'AES-GCM', iv: new Uint8Array(12) },
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['decrypt']
  );
}


// HYBRID ENCRYPTION

export async function encryptHybrid(plaintext, recipientPublicKeyJwk, senderPublicKeyJwk) {
  const aesKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt']
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(plaintext)
  );

  const rawAesKey = await crypto.subtle.exportKey('raw', aesKey);

  const rsaRecipient = await importPublicKey(recipientPublicKeyJwk);
  const rsaSender = await importPublicKey(senderPublicKeyJwk);

  const encryptedKey = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    rsaRecipient,
    rawAesKey
  );

  const encryptedKeyForSelf = await crypto.subtle.encrypt(
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


// DECRYPTION (FIXED + ROBUST)
export async function decryptHybrid(payload, privateKey) {
  if (!payload) throw new Error("Missing payload");

  const ciphertext = payload.ciphertext || payload.cipher_text;
  const iv = payload.iv;

  const encryptedKey = payload.encryptedKey || payload.encrypted_key;
  const encryptedKeyForSelf =
    payload.encryptedKeyForSelf || payload.encrypted_key_for_self;

  if (!ciphertext || !iv) {
    throw new Error("Invalid payload: missing ciphertext or IV");
  }

  const keysToTry = [encryptedKey, encryptedKeyForSelf].filter(Boolean);

  for (const keyBlob of keysToTry) {
    try {
      const rawAesKey = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        privateKey,
        base64ToArrayBuffer(keyBlob)
      );

      const aesKey = await crypto.subtle.importKey(
        'raw',
        rawAesKey,
        'AES-GCM',
        false,
        ['decrypt']
      );

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToArrayBuffer(iv) },
        aesKey,
        base64ToArrayBuffer(ciphertext)
      );

      return new TextDecoder().decode(decrypted);
    } catch (err) {
      continue;
    }
  }

  throw new Error("Decryption failed for all keys");
}


// KEY IMPORT / EXPORT
export async function importPublicKey(jwkOrPem) {
  const isJwk = typeof jwkOrPem === 'string' && jwkOrPem.startsWith('{');

  return await crypto.subtle.importKey(
    isJwk ? 'jwk' : 'spki',
    isJwk ? JSON.parse(jwkOrPem) : base64ToArrayBuffer(jwkOrPem),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt']
  );
}

export async function exportPublicKey(key) {
  const exported = await crypto.subtle.exportKey('spki', key);
  return arrayBufferToBase64(exported);
}


export function arrayBufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

export function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}