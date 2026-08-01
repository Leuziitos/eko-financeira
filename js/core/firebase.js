/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — core/firebase.js
 * Ponto único de inicialização do Firebase (app, Firestore,
 * Auth, Analytics) e de versão do SDK: todo o app importa as
 * primitivas daqui — nunca direto do CDN. Para atualizar a
 * versão do Firebase, altere apenas este arquivo.
 * ═══════════════════════════════════════════════════════════ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { getAnalytics, logEvent } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-analytics.js';
import { firebaseConfig } from '../config.js';

export const firebaseApp = initializeApp(firebaseConfig);
export const db = getFirestore(firebaseApp);
export const auth = getAuth(firebaseApp);
export const analytics = getAnalytics(firebaseApp);

// Helper para logar eventos com segurança
export function logEko(evento, params = {}) {
  try { logEvent(analytics, evento, params); } catch(e) {}
}

// ── Reexports do SDK usados pela aplicação ──────────────────
export {
  doc, getDoc, setDoc, deleteDoc, collection, getDocs, addDoc,
  query, where, orderBy, runTransaction, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

export {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
