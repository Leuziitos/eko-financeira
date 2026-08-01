/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — utils/format.js
 * Formatação e sanitização: moeda (fmt/fmtK/fmtInput), escape
 * de HTML (esc) e datas (dataHoje/diasAte). Funções puras.
 * ═══════════════════════════════════════════════════════════ */

export function fmt(v) { return 'R$ ' + Number(v).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}); }

export function fmtK(v) {
  if (v >= 1000000) return 'R$ ' + (v/1000000).toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1}) + 'M';
  if (v >= 1000)    return 'R$ ' + (v/1000).toLocaleString('pt-BR',    {minimumFractionDigits:0, maximumFractionDigits:0}) + 'k';
  return fmt(v);
}

export function fmtInput(val) {
  return 'R$ ' + val.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}

export function dataHoje() { return new Date().toLocaleDateString('pt-BR', {day:'2-digit', month:'short', year:'numeric'}); }

export function diasAte(dataISO) { const d = new Date(dataISO); const hoje = new Date(); return Math.ceil((d - hoje) / (1000*60*60*24)); }
