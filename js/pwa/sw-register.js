/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — pwa/sw-register.js
 * Registro do Service Worker principal (/sw.js — precisa
 * permanecer na raiz para ter escopo sobre todo o site).
 * ═══════════════════════════════════════════════════════════ */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.log('✅ SW registrado'))
      .catch(e => console.error('SW error:', e));
  });
}
