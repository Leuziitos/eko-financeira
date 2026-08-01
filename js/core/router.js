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

const _onEnterHooks = {};

export function onEnter(screenId, callback) {
  (_onEnterHooks[screenId] = _onEnterHooks[screenId] || []).push(callback);
}

export function ir(id) {
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
    'screen-objetivos':    'objetivos',
    'screen-simulacoes':   'simulacoes',
    'screen-aulas':        'aulas',
    'screen-planilha':     'planilha',
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
