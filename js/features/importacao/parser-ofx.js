/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/importacao/parser-ofx.js
 * Parser de extratos no formato OFX (SGML — padrão brasileiro —
 * e XML), com detecção automática de encoding (UTF-8 / ISO-8859-1
 * via TextDecoder). Converte o arquivo num array de transações
 * no mesmo formato produzido pelo parser CSV.
 * ═══════════════════════════════════════════════════════════ */
