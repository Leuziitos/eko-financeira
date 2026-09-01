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
import './features/onboarding.js';
import './features/descontinuacao.js';
import './features/feedback.js';
import './features/aulas.js';
import './features/controle.js';
import './features/metas.js';
import './features/dividas.js';
import './features/simulacoes.js';
import './features/reserva.js';
import './features/diagnosticos.js';
import './features/hub.js';
import './features/prontuario.js';
import './features/importacao/importacao.js';
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
  ir('screen-descontinuacao'); // app descontinuado — sem onboarding, sem login
}

onAuthStateChanged(auth, async (firebaseUser) => {
  if (firebaseUser) {
    // Usuário autenticado pelo Firebase Auth
    store.sessao = { email: firebaseUser.email, nome: '', renda: 0 };
    await carregarApp();
  } else {
    // Não autenticado — vai direto para a tela de descontinuação (sem login)
    const telaAtual = document.querySelector('.screen.active')?.id;
    if (telaAtual !== 'screen-descontinuacao') ir('screen-descontinuacao');
  }
});

init();
