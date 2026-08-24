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

// Cache em memória, por sessão, das queries mais repetidas no boot
// (metas/dividas/diagnosticos/reserva/simulacoes eram buscadas várias vezes
// nos mesmos segundos por hub/prontuário/jornada; controle entrou na Parte 2
// do módulo de Importação, que precisa reler os lançamentos do usuário sem
// nova query a cada verificação de duplicata). Getters em metas.js,
// dividas.js, diagnosticos.js, reserva.js, simulacoes.js e controle.js
// checam aqui antes de consultar o Firestore; funções de save/delete desses
// módulos chamam invalidar() para forçar um refetch na próxima leitura.
// Zerado inteiro no logout (auth.js) para não vazar dado de uma sessão
// para a próxima neste mesmo tab.
export const cache = {
  metas: null,
  dividas: null,
  diagnosticos: null,
  reserva: null,
  simulacoes: null,
  controle: null,
  invalidar(colecao) { this[colecao] = null; },
};
