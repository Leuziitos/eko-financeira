/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — core/router.js
 * Navegação entre telas (.screen), histórico do browser e
 * hooks de entrada de tela.
 *
 * onEnter(screenId, fn): registra callback executado ao final
 * de ir(screenId) — substitui o antigo monkey-patch de
 * window.ir (mesmo comportamento: roda após navegação,
 * pushState e analytics). Hooks NÃO disparam no popstate,
 * igual ao comportamento original.
 * ═══════════════════════════════════════════════════════════ */

import { logEko } from './firebase.js';
import { store } from './store.js';

// Telas acessíveis sem sessão ativa (store.sessao === null). Fonte única —
// usada pelo guard em ir() e pelo guard no listener popstate, para não
// duplicar a lista. IDs reais do index.html — não "screen-reset":
// a tela de recuperação de senha é screen-esqueci-senha. screen-onboarding
// entra porque roda sempre pré-login (ver main.js/init()).
const TELAS_PUBLICAS = ['screen-login','screen-cadastro','screen-esqueci-senha','screen-termo','screen-politica','screen-onboarding','screen-descontinuacao'];

const _onEnterHooks = {};

export function onEnter(screenId, callback) {
  (_onEnterHooks[screenId] = _onEnterHooks[screenId] || []).push(callback);
}

export function ir(id) {
  // Guard de autenticação — impede ativar tela protegida sem sessão
  if (!TELAS_PUBLICAS.includes(id) && !store.sessao) {
    // Redireciona para a tela de descontinuação sem adicionar a tela protegida no histórico
    history.replaceState({screen: 'screen-descontinuacao'}, '', '#screen-descontinuacao');
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-descontinuacao');
    if (el) { el.classList.add('active'); window.scrollTo(0,0); }
    return;
  }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0,0);
  // Empurra estado no histórico para interceptar botão voltar do browser/celular
  history.pushState({screen: id}, '', '#' + id);
  // Analytics — registra navegação entre módulos
  const telas = {
    'screen-hub':          'hub',
    'screen-metas':        'metas',
    'screen-dividas':      'dividas',
    'screen-simulacoes':   'simulacoes',
    'screen-aulas':        'aulas',
    'screen-reserva':      'reserva',
    'screen-diagnosticos': 'diagnosticos',
    'screen-prontuario':   'prontuario',
    'screen-controle':     'controle',
  };
  if (telas[id]) logEko('screen_view', { screen_name: telas[id] });
  const hooks = _onEnterHooks[id];
  if (hooks) hooks.forEach(fn => { try { fn(); } catch(e) { console.error('onEnter hook:', id, e); } });
}
window.ir = ir;

// Navegação para telas públicas (sem autenticação)
let _telaAnteriorPublico = 'screen-cadastro';
export function irPublico(id) {
  _telaAnteriorPublico = document.querySelector('.screen.active')?.id || 'screen-cadastro';
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0,0);
}
export function voltarPublico() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(_telaAnteriorPublico).classList.add('active');
  window.scrollTo(0,0);
}
window.irPublico = irPublico;
window.voltarPublico = voltarPublico;

// Intercepta botão voltar do browser/celular
window.addEventListener('popstate', function(e) {
  const targetScreen = (e.state && e.state.screen) ? e.state.screen : 'screen-hub';
  // Guard de autenticação — mesmo critério de ir(), aplicado ao back/forward
  if (!TELAS_PUBLICAS.includes(targetScreen) && !store.sessao) {
    history.replaceState({screen: 'screen-descontinuacao'}, '', '#screen-descontinuacao');
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-descontinuacao');
    if (el) { el.classList.add('active'); window.scrollTo(0,0); }
    return;
  }
  if (e.state && e.state.screen) {
    // Volta para a tela anterior dentro do app
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(e.state.screen);
    if (el) { el.classList.add('active'); window.scrollTo(0,0); }
  } else {
    // Se não tem estado, vai pro hub para não sair do app
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const hub = document.getElementById('screen-hub');
    if (hub) { hub.classList.add('active'); window.scrollTo(0,0); }
    history.pushState({screen: 'screen-hub'}, '', '#screen-hub');
  }
});
