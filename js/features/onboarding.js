/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/onboarding.js
 * Carrossel de boas-vindas (primeira visita). Corpo movido
 * verbatim; iniciarOnboarding() é o ponto de entrada chamado
 * pelo boot (equivale ao antigo "obIdx = 0; renderOnboard();
 * ir('screen-onboarding')" que ficava dentro de init()).
 * ═══════════════════════════════════════════════════════════ */

import { ir } from '../core/router.js';

// ── ONBOARDING ──────────────────────────────────────────────
const ONBOARD = [
  {icon:'📊', title:'Bem-vindo à Eko Financeira', desc:'Seu hub completo de educação e organização financeira. Planeje hoje para conquistar amanhã.'},
  {icon:'🔍', title:'Diagnósticos Financeiros', desc:'Descubra em qual ciclo você está, o quanto está preparado para se aposentar e como está sua relação com o dinheiro em casal.'},
  {icon:'🎯', title:'Metas e Objetivos', desc:'Crie metas financeiras, acompanhe seu progresso e ajuste quando precisar — sem abandonar o plano.'},
  {icon:'📈', title:'Simulações Inteligentes', desc:'Simule sua aposentadoria e acumulação de patrimônio com cálculos reais e cenários comparativos.'},
  {icon:'🏆', title:'Seu Prontuário Financeiro', desc:'Tudo que você faz no app alimenta seu prontuário — um histórico completo da sua evolução financeira.'}
];
let obIdx = 0;

function renderOnboard() {
  const ob = ONBOARD[obIdx];
  document.getElementById('ob-icon').textContent = ob.icon;
  document.getElementById('ob-title').textContent = ob.title;
  document.getElementById('ob-desc').textContent = ob.desc;
  document.getElementById('ob-btn').textContent = obIdx < ONBOARD.length-1 ? 'Próximo' : 'Começar!';
  const dots = document.getElementById('ob-dots');
  dots.innerHTML = ONBOARD.map((_,i) => `<div class="onboard-dot ${i===obIdx?'active':''}"></div>`).join('');
}

window.nextOnboard = function() {
  if (obIdx < ONBOARD.length-1) { obIdx++; renderOnboard(); }
  else finishOnboard();
};
window.finishOnboard = function() {
  localStorage.setItem('eko_onboard_done', '1');
  ir('screen-login');
};

// Ponto de entrada do boot (main.js)
export function iniciarOnboarding() {
  obIdx = 0;
  renderOnboard();
  ir('screen-onboarding');
}
