/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/importacao/deduplicator.js
 * Detecção de transações duplicadas entre importações e contra
 * lançamentos já existentes no Controle Financeiro.
 *
 * lancamentosExistentes é sempre um array já resolvido (vem de
 * getCFLancamentos(), que agora usa cache.controle — ver
 * core/store.js e features/controle.js) — verificarDuplicatas()
 * nunca faz query própria, só compara em memória.
 *
 * Lançamentos do Controle guardam 'valor' sempre positivo (o
 * sinal vem do campo 'tipo') e 'data' como ISO completo — daqui
 * pra baixo isso é normalizado pra bater com o formato das
 * transações importadas (valor com sinal, data 'YYYY-MM-DD').
 * ═══════════════════════════════════════════════════════════ */

// Hash simples — não é criptográfico, só uma chave de comparação estável
// baseada em data + valor + descrição já normalizada.
export function gerarHash(transacao) {
  return `${transacao.data}|${transacao.valor}|${transacao.descricaoNormalizada}`;
}

function dataSomente(iso) {
  return (iso || '').slice(0, 10);
}

function valorSinalizadoLancamento(l) {
  const abs = Math.abs(l.valor || 0);
  return l.tipo === 'gasto' ? -abs : abs;
}

function dentroTolerancia(a, b, pct = 0.05) {
  const base = Math.max(Math.abs(a), Math.abs(b), 0.01);
  return Math.abs(a - b) / base <= pct;
}

// Recebe as transações já normalizadas (com descricaoNormalizada
// preenchida) e os lançamentos já existentes do usuário (getCFLancamentos()
// — sem nova query aqui). Retorna as transações com 'hash' e 'status':
//   'duplicata_exata' — já existe lançamento com o mesmo hash (importação
//                        repetida do mesmo arquivo/transação)
//   'conflito'         — mesma data + valor dentro de 5%, mas sem hash
//                         batendo (provável duplicata manual ou de outra
//                         fonte, não tem como ter certeza)
//   'novo'              — nenhuma correspondência encontrada
export function verificarDuplicatas(transacoes, lancamentosExistentes) {
  const existentes = lancamentosExistentes || [];

  return transacoes.map(t => {
    const hash = t.hash || gerarHash(t);

    const duplicataExata = existentes.some(l => l.hash && l.hash === hash);
    if (duplicataExata) return { ...t, hash, status: 'duplicata_exata' };

    const conflito = existentes.some(l => {
      if (dataSomente(l.data) !== t.data) return false;
      return dentroTolerancia(valorSinalizadoLancamento(l), t.valor);
    });
    if (conflito) return { ...t, hash, status: 'conflito' };

    return { ...t, hash, status: 'novo' };
  });
}
