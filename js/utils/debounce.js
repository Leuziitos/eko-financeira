/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — utils/debounce.js
 * ═══════════════════════════════════════════════════════════ */

export function debounce(fn, ms) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}
