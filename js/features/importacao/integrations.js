/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/importacao/integrations.js
 * Ponte entre o módulo de Importação e o restante do app —
 * grava as transações aprovadas como lançamentos do Controle
 * Financeiro (coleção 'controle') e detecta/aplica vínculos com
 * Dívidas, Metas e Reserva de Emergência.
 *
 * As funções de aplicar/reverter aqui NÃO chamam as funções
 * confirmarPagamento()/confirmarDeposito()/salvarAporteReserva()
 * dos outros módulos — elas dependem de campos específicos do
 * DOM e de estado de tela (dividaAtual/metaAtual/reservaConfig)
 * só populados quando o usuário abre o overlay normal daquele
 * módulo. Em vez disso, reimplementamos aqui a mesma lógica de
 * gravação (mesmos campos, mesmas coleções), de forma
 * independente de tela — a tela de Dívidas/Metas/Reserva reflete
 * o resultado normalmente na próxima vez que for aberta.
 * ═══════════════════════════════════════════════════════════ */

import { db, doc, setDoc } from '../../core/firebase.js';
import { store, cache } from '../../core/store.js';
import { getDividas, saveDivida2 } from '../dividas.js';
import { getMetas, saveMeta2 } from '../metas.js';
import { getReservaConfig, calcAporteMedioReserva } from '../reserva.js';

function dentroTolerancia(a, b, pct = 0.05) {
  const base = Math.max(Math.abs(a), Math.abs(b), 0.01);
  return Math.abs(a - b) / base <= pct;
}

// ── DETECÇÃO ───────────────────────────────────────────────────
const PALAVRAS_CHAVE_META = ['POUPANCA', 'POUPANÇA', 'INVESTIMENTO', 'CDB', 'TESOURO'];

function encontrarDividaCorrespondente(t, dividas) {
  const dia = parseInt(t.data.slice(8, 10), 10);
  return dividas.find(d => d.vencimento === dia && dentroTolerancia(Math.abs(t.valor), d.parcela || 0, 0.05));
}

function encontrarMetaCorrespondente(t, metas) {
  const descUpper = (t.descricaoNormalizada || '').toUpperCase();
  const temPalavraChave = PALAVRAS_CHAVE_META.some(p => descUpper.includes(p));
  const porValor = metas.find(m => dentroTolerancia(Math.abs(t.valor), m.mensal || 0, 0.05));
  if (porValor) return porValor;
  if (temPalavraChave && metas.length === 1) return metas[0];
  return null;
}

function bateComReserva(t, reservaConfig, aporteEsperado) {
  if (!reservaConfig || !aporteEsperado) return false;
  return dentroTolerancia(Math.abs(t.valor), aporteEsperado, 0.05);
}

// Analisa cada transação de gasto aprovada e anota (sem gravar nada ainda)
// uma sugestão de vínculo com Dívidas/Metas/Reserva quando encontra
// correspondência. Ordem de prioridade quando mais de uma bateria: dívida
// (dia do vencimento + valor) > meta (palavra-chave ou valor) > reserva
// (só valor) — da correspondência mais específica pra menos específica.
export async function detectarIntegracoes(transacoes) {
  let dividas = [], metas = [], reservaConfig = null;
  try { dividas = await getDividas(); } catch(e) {}
  try { metas = (await getMetas()).filter(m => !m.concluida); } catch(e) {}
  try { reservaConfig = await getReservaConfig(); } catch(e) {}
  const aporteEsperadoReserva = reservaConfig ? calcAporteMedioReserva(reservaConfig.historico || []) : 0;

  return transacoes.map(t => {
    if (t.tipo !== 'gasto') return t;

    const divida = encontrarDividaCorrespondente(t, dividas);
    if (divida) {
      return { ...t, sugestaoIntegracao: { tipo: 'divida', id: divida._id, nome: divida.nome, mensagem: `💳 Isso é o pagamento da dívida ${divida.nome}?` } };
    }

    const meta = encontrarMetaCorrespondente(t, metas);
    if (meta) {
      return { ...t, sugestaoIntegracao: { tipo: 'meta', id: meta._id, nome: meta.nome, mensagem: `🎯 Isso é um depósito para sua meta ${meta.nome}?` } };
    }

    if (bateComReserva(t, reservaConfig, aporteEsperadoReserva)) {
      return { ...t, sugestaoIntegracao: { tipo: 'reserva', id: null, nome: 'Reserva de Emergência', mensagem: '🛡️ Isso é um aporte na sua Reserva de Emergência?' } };
    }

    return t;
  });
}

// ── APLICAR (usuário confirmou "Sim" na revisão) ────────────────
async function aplicarPagamentoDivida(dividaId, valor) {
  const dividas = await getDividas();
  const div = dividas.find(d => d._id === dividaId);
  if (!div) return null;
  if (!div.historicoPagamentos) div.historicoPagamentos = [];
  if (valor >= div.parcela) {
    div.parcelasRestantes = Math.max(0, (div.parcelasRestantes || 1) - 1);
    div.emAtraso = false;
    div.valorAtrasado = 0;
    div.historicoPagamentos.push({ tipo: 'parcela', valor, data: new Date().toISOString() });
  } else if (valor > 0) {
    div.emAtraso = true;
    div.valorAtrasado = div.parcela - valor;
    div.historicoPagamentos.push({ tipo: 'parcela_parcial', valor, data: new Date().toISOString() });
  } else {
    return null;
  }
  await saveDivida2(div);
  return { tipo: 'divida', id: dividaId, valorAplicado: valor };
}

// Aplica no primeiro depósito ainda não pago da meta — mesmo critério que a
// tela de Metas usa pra abrir o próximo depósito pendente. Não replica os
// fluxos interativos de ajuste de excedente/déficit (mostrarFase2Extra/
// Deficit em metas.js) — isso é uma decisão do usuário na tela normal de
// Metas, não algo pra resolver sozinho durante a revisão da importação.
async function aplicarDepositoMeta(metaId, valor) {
  const metas = await getMetas();
  const meta = metas.find(m => m._id === metaId);
  if (!meta) return null;
  const idx = meta.depositos.findIndex(d => !d.pago);
  if (idx === -1 || valor <= 0) return null;
  const previsto = meta.mensal;
  meta.depositos[idx] = { pago: true, parcial: valor < previsto, extra: valor > previsto, valor };
  await saveMeta2(meta);
  return { tipo: 'meta', id: metaId, depositoIdx: idx, valorAplicado: valor };
}

async function aplicarAporteReserva(valor) {
  const config = await getReservaConfig();
  if (!config) return null;
  const novoHistorico = [...(config.historico || []), { tipo: 'aporte', valor, descricao: 'Identificado via importação de extrato', data: new Date().toISOString() }];
  const novoSaldo = (config.saldoAtual || 0) + valor;
  await setDoc(doc(db, 'reserva', store.sessao.email), { ...config, saldoAtual: novoSaldo, historico: novoHistorico, atualizadoEm: new Date().toISOString() });
  cache.invalidar('reserva');
  return { tipo: 'reserva', valorAplicado: valor };
}

// Aplica a sugestão confirmada e retorna o vínculo a ser gravado no campo
// vinculoModulo do lançamento (usado depois por reverterIntegracao(), na
// reversão da importação) — ou null se não foi possível aplicar.
export async function aplicarIntegracao(sugestao, valor) {
  if (!sugestao) return null;
  if (sugestao.tipo === 'divida') return aplicarPagamentoDivida(sugestao.id, valor);
  if (sugestao.tipo === 'meta') return aplicarDepositoMeta(sugestao.id, valor);
  if (sugestao.tipo === 'reserva') return aplicarAporteReserva(valor);
  return null;
}

// ── REVERTER (desfazer importação — ver desfazerImportacao em importacao.js) ──
async function reverterPagamentoDivida(vinculo) {
  const dividas = await getDividas();
  const div = dividas.find(d => d._id === vinculo.id);
  if (!div) return;
  div.parcelasRestantes = (div.parcelasRestantes || 0) + 1;
  if (div.historicoPagamentos) {
    const idx = div.historicoPagamentos.findIndex(h => h.valor === vinculo.valorAplicado && (h.tipo === 'parcela' || h.tipo === 'parcela_parcial'));
    if (idx > -1) div.historicoPagamentos.splice(idx, 1);
  }
  await saveDivida2(div);
}

async function reverterDepositoMeta(vinculo) {
  const metas = await getMetas();
  const meta = metas.find(m => m._id === vinculo.id);
  if (!meta || !meta.depositos[vinculo.depositoIdx]) return;
  meta.depositos[vinculo.depositoIdx] = { pago: false, parcial: false, extra: false, valor: 0 };
  await saveMeta2(meta);
}

async function reverterAporteReserva(vinculo) {
  const config = await getReservaConfig();
  if (!config) return;
  const novoSaldo = Math.max(0, (config.saldoAtual || 0) - vinculo.valorAplicado);
  const historico = (config.historico || []).slice();
  const idx = historico.findIndex(h => h.tipo === 'aporte' && h.valor === vinculo.valorAplicado);
  if (idx > -1) historico.splice(idx, 1);
  await setDoc(doc(db, 'reserva', store.sessao.email), { ...config, saldoAtual: novoSaldo, historico, atualizadoEm: new Date().toISOString() });
  cache.invalidar('reserva');
}

export async function reverterIntegracao(vinculo) {
  if (!vinculo) return;
  if (vinculo.tipo === 'divida') return reverterPagamentoDivida(vinculo);
  if (vinculo.tipo === 'meta') return reverterDepositoMeta(vinculo);
  if (vinculo.tipo === 'reserva') return reverterAporteReserva(vinculo);
}
