/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — core/errors.js
 * Tratamento global de erros e conectividade: tela de erro
 * crítico, promises rejeitadas (Firebase offline/indisponível)
 * e eventos online/offline. Listeners registrados no top-level
 * (exceção intencional à regra "sem execução no top-level").
 * ═══════════════════════════════════════════════════════════ */

import { toast } from '../utils/dom.js';

export function mostrarErroGlobal(msg) {
  const el = document.getElementById('screen-erro-global');
  const msgEl = document.getElementById('erro-global-msg');
  if (el) {
    el.style.display = 'flex';
    if (msg && msgEl) msgEl.textContent = msg;
  }
}

// Captura erros JS não tratados
window.addEventListener('error', (e) => {
  // Ignora erros de extensões do browser e erros menores
  if (!e.filename || e.filename.includes('extension')) return;
  console.error('Erro global:', e);
  // Só mostra a tela para erros críticos (não poluir por bugs menores)
});

// Captura promises rejeitadas não tratadas
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || '';
  // Firebase offline
  if (msg.includes('offline') || msg.includes('network') || msg.includes('Failed to fetch')) {
    mostrarErroGlobal('Sem conexão com a internet. Verifique sua rede e tente novamente.');
    e.preventDefault();
  }
  // Firebase indisponível
  if (msg.includes('unavailable') || msg.includes('UNAVAILABLE')) {
    mostrarErroGlobal('O servidor está temporariamente indisponível. Aguarde alguns minutos e tente novamente.');
    e.preventDefault();
  }
});

// Detecta quando fica offline/online
window.addEventListener('offline', () => {
  mostrarErroGlobal('Você está sem internet. Reconecte e tente novamente.');
});

window.addEventListener('online', () => {
  // Esconde a tela de erro quando voltar a conexão
  const el = document.getElementById('screen-erro-global');
  if (el) el.style.display = 'none';
  toast('✅ Conexão restaurada!');
});
