/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/importacao/importacao.js
 * Importação de Extrato — ponto de entrada do módulo: onboarding,
 * navegação (#screen-importacao), histórico de importações
 * (localStorage) e orquestração dos demais arquivos deste módulo
 * (parsers, normalizer, deduplicator, categorizer, integrations).
 * Processamento 100% local — nenhum dado bancário é enviado ao
 * servidor ou ao Firestore.
 * ═══════════════════════════════════════════════════════════ */
