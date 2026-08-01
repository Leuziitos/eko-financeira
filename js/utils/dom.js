/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — utils/dom.js
 * Helpers de UI: mensagens inline (showMsg/limparMsg), toast
 * e overlays/sheets (abrirOverlay/fecharOverlay).
 * window.fecharOverlay é exigido pelos onclick do HTML.
 * ═══════════════════════════════════════════════════════════ */

import { setupMoneyInputs } from './money.js';

export function showMsg(id, tipo, txt) { const el = document.getElementById(id); el.className = 'msg '+tipo; el.textContent = txt; }

export function limparMsg(id) { const el = document.getElementById(id); el.className = 'msg'; el.textContent = ''; }

export function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3200); }

export function fecharOverlay(id){document.getElementById(id).classList.add('hidden');}
window.fecharOverlay = fecharOverlay;

// Item 4 — reaplicar máscara ao abrir qualquer overlay
export function abrirOverlay(id) {
  document.getElementById(id).classList.remove('hidden');
  setupMoneyInputs(); // garante máscara em todos os campos visíveis
}

// Anti duplo-toque nos saves: captura o botão que originou o clique
// (via window.event, mesmo padrão já usado nos onclick do HTML) para
// desabilitá-lo durante o await. Uso:
//   const btn = btnDoClique(); if (btn) btn.disabled = true;
//   try { ... } finally { liberarBotao(btn); }
export function btnDoClique() {
  const ev = window.event;
  const alvo = ev && (ev.target || ev.currentTarget);
  return alvo && alvo.closest ? alvo.closest('button') : null;
}
export function liberarBotao(btn) { if (btn) btn.disabled = false; }
