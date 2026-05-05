import { signup, login } from './api.js';
import { generateKeyPair, wrapPrivateKey, exportPublicKey, arrayBufferToBase64 } from './crypto.js';
import { savePrivateKey } from './storage.js';

const authForm = document.getElementById('authForm');
const toggleAuth = document.getElementById('toggleAuth');
const confirmPasswordGroup = document.getElementById('confirmPasswordGroup');
const authBtn = document.getElementById('authBtn');
const btnText = authBtn.querySelector('.btn-text');
const spinner = authBtn.querySelector('.spinner');
const errorMessage = document.getElementById('errorMessage');
const authSubtitle = document.getElementById('authSubtitle');
const toggleText = document.getElementById('toggleText');

const usernameGroup = document.getElementById('usernameGroup');
const usernameInput = document.getElementById('username');
const emailLabel = document.getElementById('emailLabel');
const emailInput = document.getElementById('email');

let isLogin = true;

toggleAuth.addEventListener('click', (e) => {
  e.preventDefault();
  isLogin = !isLogin;
  
  if (isLogin) {
    btnText.textContent = 'Sign In';
    authSubtitle.textContent = 'Secure End-to-End Encrypted Messaging';
    toggleText.innerHTML = "Don't have an account? <a href='#' id='toggleAuth'>Sign Up</a>";
    confirmPasswordGroup.classList.add('hidden');
    usernameGroup.classList.add('hidden');
    emailLabel.textContent = 'Username';
    emailInput.placeholder = 'johndoe123';
    usernameInput.required = false;
  } else {
    btnText.textContent = 'Create Account';
    authSubtitle.textContent = 'Join the private conversation';
    toggleText.innerHTML = "Already have an account? <a href='#' id='toggleAuth'>Sign In</a>";
    confirmPasswordGroup.classList.remove('hidden');
    usernameGroup.classList.remove('hidden');
    emailLabel.textContent = 'Display Name';
    emailInput.placeholder = 'John Doe';
    usernameInput.required = true;
  }
  
  // Re-attach listener
  document.getElementById('toggleAuth').addEventListener('click', (e) => {
    e.preventDefault();
    toggleAuth.click();
  });
  
  errorMessage.classList.add('hidden');
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const identifier = emailInput.value.trim(); // This is username on login, display_name on signup
  const password = document.getElementById('password').value;
  
  errorMessage.classList.add('hidden');
  setLoading(true);
  
  try {
    if (isLogin) {
      // identifier is the username here
      const data = await login(identifier, password);
      
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('refreshToken', data.refresh_token);
      localStorage.setItem('userId', data.user.id);
      localStorage.setItem('username', data.user.username);
      
      await savePrivateKey(data.user.id, data.user.wrapped_private_key);
      localStorage.setItem('pbkdf2Salt', data.user.pbkdf2_salt);
      localStorage.setItem('sessionPassword', password);

      window.location.href = './chat.html';
    } else {
      const username = usernameInput.value.trim();
      const displayName = identifier;
      const confirmPassword = document.getElementById('confirmPassword').value;
      
      if (password !== confirmPassword) throw new Error('Passwords do not match');
      if (password.length < 8) throw new Error('Password must be at least 8 characters');
      if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        throw new Error('Username may only contain letters, digits, _ and -');
      }

      // 1. Generate Key Pair
      const keyPair = await generateKeyPair();
      const publicKeyPem = await exportPublicKey(keyPair.publicKey);
      
      // 2. Wrap Private Key
      const salt = window.crypto.getRandomValues(new Uint8Array(16));
      const wrappedPrivateKey = await wrapPrivateKey(keyPair.privateKey, password, salt);
      const saltBase64 = arrayBufferToBase64(salt);
      
      // 3. Register User
      const payload = {
        username,
        display_name: displayName,
        password: password,
        public_key: publicKeyPem,
        wrapped_private_key: wrappedPrivateKey,
        pbkdf2_salt: saltBase64
      };
      
      const data = await signup(payload);
      
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('refreshToken', data.refresh_token);
      localStorage.setItem('userId', data.user.id);
      localStorage.setItem('username', data.user.username);
      
      await savePrivateKey(data.user.id, wrappedPrivateKey);
      localStorage.setItem('pbkdf2Salt', saltBase64);
      localStorage.setItem('sessionPassword', password);

      window.location.href = './chat.html';
    }
  } catch (err) {
    errorMessage.textContent = err.message;
    errorMessage.classList.remove('hidden');
    console.error(err);
  } finally {
    setLoading(false);
  }
});

function setLoading(loading) {
  if (loading) {
    authBtn.disabled = true;
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');
  } else {
    authBtn.disabled = false;
    btnText.classList.remove('hidden');
    spinner.classList.add('hidden');
  }
}
