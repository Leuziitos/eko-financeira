/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/descontinuacao.js
 * Tela única do app: coleta a resposta do usuário sobre a
 * descontinuação do projeto (coleção 'descontinuacao') e
 * bloqueia respostas repetidas via localStorage.
 * ═══════════════════════════════════════════════════════════ */

import { db, addDoc, collection } from '../core/firebase.js';
import { store } from '../core/store.js';

const RESPONDIDO_KEY = 'eko_descontinuacao_respondido';

function mostrarAgradecimento(resposta) {
  const botoes = document.getElementById('descontinuacao-botoes');
  const msg = document.getElementById('descontinuacao-resposta');
  if (botoes) botoes.style.display = 'none';
  if (msg) {
    msg.textContent = resposta === 'sim'
      ? 'Obrigado! Vamos considerar sua resposta. 🌱'
      : 'Obrigado pelo tempo que passou com a gente. 🌱';
    msg.style.display = 'block';
  }
}

window.responderDescontinuacao = async function(resposta) {
  if (localStorage.getItem(RESPONDIDO_KEY)) { mostrarAgradecimento(resposta); return; }
  try {
    await addDoc(collection(db, 'descontinuacao'), {
      resposta,
      email: store.sessao?.email || 'anonimo',
      respondidoEm: new Date().toISOString(),
    });
  } catch(e) {
    console.error('responderDescontinuacao error:', e);
  }
  localStorage.setItem(RESPONDIDO_KEY, resposta);
  mostrarAgradecimento(resposta);
};

// Se o usuário já respondeu (nesta ou em outra sessão), abre a tela já com o agradecimento
document.addEventListener('DOMContentLoaded', () => {
  const resposta = localStorage.getItem(RESPONDIDO_KEY);
  if (resposta) mostrarAgradecimento(resposta);
});
