/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — core/store.js
 * Estado global mutável compartilhado entre módulos.
 *
 * Regra: só entra aqui o que é lido/escrito por MAIS DE UM
 * módulo. Estado de escopo único (ex.: quizIdx, metaAtual,
 * cfMesVis) permanece como `let` local no módulo dono.
 *
 * Os módulos mutam propriedades (store.sessao = ...) — nunca
 * reatribuem o objeto. A referência é única, garantida pelo
 * cache de ES Modules do browser.
 * ═══════════════════════════════════════════════════════════ */

export const store = {
  // Sessão do usuário autenticado: { email, nome, renda } · null = deslogado.
  // Escrita: auth (login/logout/onAuthStateChanged). Leitura: todas as features.
  sessao: null,
};
