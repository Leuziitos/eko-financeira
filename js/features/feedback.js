/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/feedback.js
 * Feedback do usuário (bug/sugestão/elogio → coleção
 * 'feedbacks') e Indicar o app (WhatsApp/Instagram).
 * Corpo movido verbatim do monólito.
 * ═══════════════════════════════════════════════════════════ */

import { db, addDoc, collection, logEko } from '../core/firebase.js';
import { store } from '../core/store.js';
import { abrirOverlay, fecharOverlay, showMsg, limparMsg, toast } from '../utils/dom.js';

// ════════════════════════════════════════════════
// FEEDBACK
// ════════════════════════════════════════════════
let fbTipoAtual = 'bug';


window.abrirIndicar = function() {
  abrirOverlay('overlay-indicar');
};

window.indicarWhatsApp = function() {
  const msg = encodeURIComponent('Ei! Estou usando a Eko Financeira para organizar minhas finanças. É gratuito e incrível! 🌱\n\nAcessa aqui: https://app.ekofinanceira.com.br');
  window.open('https://wa.me/?text=' + msg, '_blank');
};

window.indicarInstagram = function() {
  window.open('https://instagram.com/ekofinanceira', '_blank');
};

window.abrirFeedback = function() {
  fbTipoAtual = 'bug';
  selecionarTipoFeedback('bug');
  const msg = document.getElementById('fb-mensagem');
  if(msg) msg.value = '';
  limparMsg('fb-msg');
  abrirOverlay('overlay-feedback');
};

window.selecionarTipoFeedback = function(tipo) {
  fbTipoAtual = tipo;
  const tipos = {
    bug:      {cor:'var(--red)',    bg:'var(--red-light)',        label:'🐛 Bug'},
    sugestao: {cor:'var(--eko-green)', bg:'var(--eko-green-light)', label:'💡 Sugestão'},
    elogio:   {cor:'#f59e0b',      bg:'#fef3c7',                 label:'👍 Elogio'},
  };
  ['bug','sugestao','elogio'].forEach(t => {
    const btn = document.getElementById('fb-tipo-'+t);
    if(!btn) return;
    if(t === tipo) {
      btn.style.border = `2px solid ${tipos[t].cor}`;
      btn.style.background = tipos[t].bg;
      btn.style.color = tipos[t].cor;
    } else {
      btn.style.border = '2px solid var(--border)';
      btn.style.background = 'var(--surface)';
      btn.style.color = 'var(--text-muted)';
    }
  });
};

window.enviarFeedback = async function() {
  limparMsg('fb-msg');
  const mensagem = document.getElementById('fb-mensagem').value.trim();
  if(!mensagem) { showMsg('fb-msg','error','Escreva sua mensagem antes de enviar.'); return; }
  try {
    await addDoc(collection(db,'feedbacks'), {
      email: store.sessao.email,
      tipo: fbTipoAtual,
      mensagem,
      criadoEm: new Date().toISOString(),
      lido: false,
    });
    fecharOverlay('overlay-feedback');
    toast('💬 Feedback enviado! Obrigado! 🌱');
    logEko('feedback_enviado', {tipo: fbTipoAtual});
  } catch(e) {
    showMsg('fb-msg','error','Erro ao enviar. Verifique sua conexão.');
  }
};
