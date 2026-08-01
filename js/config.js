/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — config.js
 * Constantes de configuração da aplicação. Zero lógica.
 * A firebaseConfig é pública por design (client-side Firebase);
 * a segurança real vem das Security Rules do Firestore.
 * ═══════════════════════════════════════════════════════════ */

export const firebaseConfig = {
  apiKey: "AIzaSyAu5cMIkf6zn6sTt3M5eTV5uoPE002ad2k",
  authDomain: "eko-financeira.firebaseapp.com",
  projectId: "eko-financeira",
  storageBucket: "eko-financeira.firebasestorage.app",
  messagingSenderId: "600120589786",
  appId: "1:600120589786:web:b71b059b58b15caae4d4e3",
  measurementId: "G-ZJBF8CPZ9R"
};

export const ONESIGNAL_APP_ID = 'c91df304-8d91-4528-bacd-edb75e918fb1';

// Chaves de localStorage
export const SESS_KEY = 'eko_sess';
export const PUSH_OPTIN_KEY = 'eko_push_optin_';
