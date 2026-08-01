/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — core/theme.js
 * Tema claro/escuro: aplica o tema salvo no carregamento
 * (execução top-level intencional — deve ser o primeiro
 * import do entry point) e expõe window.toggleTheme para o
 * botão no HTML.
 * ═══════════════════════════════════════════════════════════ */

const savedTheme = localStorage.getItem('eko_theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
document.getElementById('theme-btn').textContent = savedTheme === 'dark' ? '☀️' : '🌙';
window.toggleTheme = function() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  document.getElementById('theme-btn').textContent = next === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('eko_theme', next);
};
