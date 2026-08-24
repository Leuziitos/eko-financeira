/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — main.js (ENTRY POINT)
 * Compõe a aplicação: importa core, utils, todas as features
 * e o PWA, e executa o boot (init + onAuthStateChanged).
 *
 * Ordem de avaliação garantida pelo grafo de ES Modules:
 * theme primeiro (evita flash de tema errado), firebase antes
 * de qualquer consumidor, features antes de interação do
 * usuário (window.* dos onclick registrados no import).
 * Boot movido verbatim do inline do index.html.
 * ═══════════════════════════════════════════════════════════ */

import './core/theme.js';
import './core/errors.js';
import { auth, onAuthStateChanged } from './core/firebase.js';
import { store } from './core/store.js';
import { ir } from './core/router.js';
import { applyMoneyMask } from './utils/money.js';
// Módulos de feature — importados também pelos efeitos
// (registro dos window.* referenciados nos onclick do HTML)
import { iniciarOnboarding } from './features/onboarding.js';
import './features/feedback.js';
import './features/dica-ia.js';
import './features/aulas.js';
import './features/controle.js';
import './features/metas.js';
import './features/dividas.js';
import './features/simulacoes.js';
import './features/reserva.js';
import './features/diagnosticos.js';
import './features/hub.js';
import './features/prontuario.js';
import './features/push-optin.js';
import { carregarApp } from './features/auth.js';
// PWA — banner de instalação e registro do Service Worker
import './pwa/install-banner.js';
import './pwa/sw-register.js';

// Aplica máscara no campo de renda do cadastro já no carregamento
document.addEventListener('DOMContentLoaded', () => {
  ['cad-renda'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.oninput = function() { applyMoneyMask(this); };
  });
});

async function init() {
  const obDone = localStorage.getItem('eko_onboard_done');
  if (!obDone) { iniciarOnboarding(); return; }
  ir('screen-login'); // aguarda onAuthStateChanged
}

onAuthStateChanged(auth, async (firebaseUser) => {
  if (firebaseUser) {
    // Usuário autenticado pelo Firebase Auth
    store.sessao = { email: firebaseUser.email, nome: '', renda: 0 };
    await carregarApp();
  } else {
    // Não autenticado — vai para login (a menos que esteja no onboarding)
    const obDone = localStorage.getItem('eko_onboard_done');
    const telaAtual = document.querySelector('.screen.active')?.id;
    const telasPublicas = ['screen-onboarding', 'screen-termo', 'screen-politica'];
    if (obDone && !telasPublicas.includes(telaAtual)) {
      ir('screen-login');
    }
  }
});

init();
