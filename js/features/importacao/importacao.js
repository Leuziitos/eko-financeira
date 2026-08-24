/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/importacao/importacao.js
 * Importação de Extrato — ponto de entrada do módulo: onboarding,
 * navegação (#screen-importacao), histórico de importações
 * (localStorage) e orquestração dos demais arquivos deste módulo
 * (parsers, normalizer, deduplicator, categorizer, integrations).
 * Processamento 100% local — nenhum dado bancário é enviado ao
 * servidor ou ao Firestore.
 *
 * Formato de cada entrada de 'eko_importacoes' (localStorage, array JSON),
 * gravado por confirmarImportacao():
 *   { id (uuid, == importacaoId dos lançamentos), fonte,
 *     periodo_inicio (YYYY-MM-DD), periodo_fim (YYYY-MM-DD),
 *     total_transacoes (achadas no arquivo), aprovadas (selecionadas pelo
 *     usuário e gravadas), importado_em (ISO) }
 * ═══════════════════════════════════════════════════════════ */

import { db, doc, collection, query, where, getDocs, writeBatch } from '../../core/firebase.js';
import { store, cache } from '../../core/store.js';
import { ir } from '../../core/router.js';
import { fmt, esc } from '../../utils/format.js';
import { toast, abrirOverlay, fecharOverlay } from '../../utils/dom.js';
import { parseOFX, decodificarArquivoOFX, extrairOrgOFX } from './parser-ofx.js';
import { parseCSV } from './parser-csv.js';
import { normalizarDescricao } from './normalizer.js';
import { verificarDuplicatas, gerarHash } from './deduplicator.js';
import { categorizarTransacoes, salvarCatAprendida } from './categorizer.js';
import { detectarIntegracoes, aplicarIntegracao, reverterIntegracao } from './integrations.js';
import { getCFLancamentos, getCFCategorias, saveCFCategorias, cfChaveMes } from '../controle.js';

const ONBOARDING_KEY = 'eko_importacao_onboarding';
const HISTORICO_KEY = 'eko_importacoes';
const FONTES_KEY = 'eko_importacao_fontes';
const LIMITE_TRANSACOES_AVISO = 500;

// ── ONBOARDING / NAVEGAÇÃO ───────────────────────────────────
function mostrarConteudoImportacao() {
  document.getElementById('importacao-onboarding').style.display = 'none';
  document.getElementById('importacao-conteudo').style.display = '';
  renderHistoricoImportacoes();
  inicializarDashboardImportacao();
}

// ── HISTÓRICO DE IMPORTAÇÕES ─────────────────────────────────
function getHistoricoImportacoes() {
  try {
    return JSON.parse(localStorage.getItem(HISTORICO_KEY)) || [];
  } catch(e) { return []; }
}

function renderHistoricoImportacoes() {
  const el = document.getElementById('importacao-historico');
  if (!el) return;
  const historico = getHistoricoImportacoes();

  if (!historico.length) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:1.25rem;color:var(--text-muted);font-size:13px">Nenhuma importação realizada ainda.</div>`;
    return;
  }

  const itens = historico.map((imp) => {
    const dataFmt = imp.importado_em ? new Date(imp.importado_em).toLocaleDateString('pt-BR') : '';
    const inicioFmt = imp.periodo_inicio ? new Date(imp.periodo_inicio + 'T12:00:00').toLocaleDateString('pt-BR') : '';
    const fimFmt = imp.periodo_fim ? new Date(imp.periodo_fim + 'T12:00:00').toLocaleDateString('pt-BR') : '';
    return `<div class="pront-item" style="margin-bottom:6px">
      <div class="pront-item-left">
        <div class="pront-item-icon">📥</div>
        <div>
          <div class="pront-item-title">${esc(imp.fonte || 'Fonte desconhecida')}</div>
          <div class="pront-item-sub">${inicioFmt} a ${fimFmt} · ${imp.aprovadas || 0} transações · ${dataFmt}</div>
        </div>
      </div>
      <button onclick="confirmarDesfazerImportacao('${imp.id}')" class="btn btn-sm" style="background:var(--surface);border:1px solid var(--border);color:var(--text-muted)">Desfazer</button>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="section-title" style="margin-bottom:8px">📥 Importações realizadas</div>${itens}`;
}

// ── DASHBOARD ──────────────────────────────────────────────────
let importacaoMesVis = new Date().getMonth();
let importacaoAnoVis = new Date().getFullYear();
const CATS_VISIVEIS_DASHBOARD = 5;

function inicializarDashboardImportacao() {
  importacaoMesVis = new Date().getMonth();
  importacaoAnoVis = new Date().getFullYear();
  renderDashboard(importacaoMesVis, importacaoAnoVis);
}

// Lê os lançamentos do Controle Financeiro que vieram de importação
// (campo importacaoId) no mês/ano dado, calcula entradas/saídas/saldo e o
// breakdown por categoria com percentual. getCFLancamentos() já usa
// cache.controle — navegar entre meses (◄ ►) não dispara query nova, só
// refiltra o array já carregado.
async function renderDashboard(mes, ano) {
  const mesEl = document.getElementById('importacao-mes-label');
  const anoEl = document.getElementById('importacao-ano-label');
  if (mesEl) mesEl.textContent = new Date(ano, mes, 1).toLocaleDateString('pt-BR', { month: 'long' }).replace(/^\w/, c => c.toUpperCase());
  if (anoEl) anoEl.textContent = ano;

  let lancamentos = [];
  try { lancamentos = await getCFLancamentos(); } catch(e) {}

  const chave = cfChaveMes(ano, mes);
  const doMes = lancamentos.filter(l => l.chaveMes === chave && l.importacaoId);

  const entradas = doMes.filter(l => l.tipo === 'receita').reduce((s, l) => s + (l.valor || 0), 0);
  const saidas = doMes.filter(l => l.tipo === 'gasto').reduce((s, l) => s + (l.valor || 0), 0);
  const saldo = entradas - saidas;

  const entradasEl = document.getElementById('importacao-entradas');
  const saidasEl = document.getElementById('importacao-saidas');
  const saldoEl = document.getElementById('importacao-saldo');
  if (entradasEl) entradasEl.textContent = fmt(entradas);
  if (saidasEl) saidasEl.textContent = fmt(saidas);
  if (saldoEl) { saldoEl.textContent = fmt(saldo); saldoEl.style.color = saldo >= 0 ? 'var(--eko-green)' : 'var(--red)'; }

  const catsEl = document.getElementById('importacao-categorias');
  if (!catsEl) return;

  const porCategoria = {};
  doMes.filter(l => l.tipo === 'gasto').forEach(l => { porCategoria[l.categoria] = (porCategoria[l.categoria] || 0) + l.valor; });
  const totalGastos = Object.values(porCategoria).reduce((s, v) => s + v, 0);

  if (!totalGastos) { catsEl.innerHTML = ''; return; }

  let categorias = { gasto: [], receita: [] };
  try { categorias = await getCFCategorias(); } catch(e) {}
  const todasCats = [...(categorias.gasto || []), ...(categorias.receita || [])];

  const ordenado = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
  const linhaCategoria = ([id, val]) => {
    const cat = todasCats.find(c => c.id === id);
    const nome = cat ? cat.nome : id;
    const pct = Math.round((val / totalGastos) * 100);
    const blocos = Math.min(5, Math.round(pct / 20));
    const barra = '█'.repeat(blocos) + '░'.repeat(5 - blocos);
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12px">
      <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nome)}</div>
      <div style="font-weight:700;white-space:nowrap">${fmt(val)}</div>
      <div style="font-family:monospace;letter-spacing:1px;color:var(--eko-green);white-space:nowrap">${barra}</div>
      <div style="width:34px;text-align:right;color:var(--text-muted)">${pct}%</div>
    </div>`;
  };

  const visiveis = ordenado.slice(0, CATS_VISIVEIS_DASHBOARD);
  const resto = ordenado.slice(CATS_VISIVEIS_DASHBOARD);

  let html = `<div class="section-title" style="margin:1rem 0 8px">Por categoria</div>` + visiveis.map(linhaCategoria).join('');
  if (resto.length) {
    html += `<button onclick="expandirCategoriasImportacao()" id="importacao-ver-todas-btn" class="btn btn-sm" style="width:100%;margin-top:6px;background:var(--surface);border:1px solid var(--border)">+ Ver todas (${resto.length})</button>
      <div id="importacao-categorias-resto" style="display:none">${resto.map(linhaCategoria).join('')}</div>`;
  }
  catsEl.innerHTML = html;
}
window.renderDashboard = renderDashboard;

window.expandirCategoriasImportacao = function() {
  const resto = document.getElementById('importacao-categorias-resto');
  const btn = document.getElementById('importacao-ver-todas-btn');
  if (resto) resto.style.display = '';
  if (btn) btn.style.display = 'none';
};

window.navegarMesImportacao = function(dir) {
  importacaoMesVis += dir;
  if (importacaoMesVis < 0) { importacaoMesVis = 11; importacaoAnoVis--; }
  if (importacaoMesVis > 11) { importacaoMesVis = 0; importacaoAnoVis++; }
  renderDashboard(importacaoMesVis, importacaoAnoVis);
};

// ── RECONHECIMENTO E NOMEAÇÃO DE FONTE ────────────────────────
// Formato de cada entrada de 'eko_importacao_fontes' (localStorage, array
// JSON): { nome, assinatura, tipo: 'ofx'|'csv' }. 'assinatura' é o
// cabeçalho normalizado do CSV (ex.: "date,category,title,amount") ou,
// para OFX (que não tem cabeçalho de colunas próprio), "ofx" + a tag <ORG>
// quando presente no arquivo — ver extrairOrgOFX() em parser-ofx.js.
// Limitação conhecida desta Parte 1: um OFX sem <ORG> cai sempre na mesma
// assinatura genérica "ofx", então só é possível memorizar uma fonte OFX
// "sem nome de banco identificável" por vez.
function getFontesSalvas() {
  try { return JSON.parse(localStorage.getItem(FONTES_KEY)) || []; } catch(e) { return []; }
}

function normalizarAssinatura(cabecalho) {
  return (cabecalho || '').trim().toLowerCase();
}

// Compara a assinatura do arquivo (cabecalho) com as fontes já salvas.
// 'colunas' fica reservado para uma comparação mais refinada (coluna a
// coluna) numa parte futura — nesta Parte 1 a assinatura já normalizada
// (cabecalho) é suficiente para o match.
function detectarFonte(cabecalho, colunas) {
  const assinatura = normalizarAssinatura(cabecalho);
  const match = getFontesSalvas().find(f => f.assinatura === assinatura);
  return match ? match.nome : null;
}

function salvarFonte(cabecalho, nome, tipoArquivo) {
  const fontes = getFontesSalvas();
  const assinatura = normalizarAssinatura(cabecalho);
  const existente = fontes.find(f => f.assinatura === assinatura);
  if (existente) existente.nome = nome;
  else fontes.push({ nome, assinatura, tipo: tipoArquivo });
  localStorage.setItem(FONTES_KEY, JSON.stringify(fontes));
}

// ── FLUXO DE SELEÇÃO DE ARQUIVO ───────────────────────────────
// Estado da importação em andamento, enquanto o usuário passa pelas fases
// do overlay de confirmação (fonte conhecida/nova, depois período).
let importacaoEstado = null;

window.handleArquivoImportacao = async function(input) {
  const arquivo = input.files && input.files[0];
  input.value = ''; // permite selecionar o mesmo arquivo de novo depois
  if (!arquivo) return;

  const ehOFX = /\.ofx$/i.test(arquivo.name || '');
  const ehCSV = /\.csv$/i.test(arquivo.name || '');
  if (!ehOFX && !ehCSV) { toast('❌ Formato não suportado. Envie um arquivo .ofx ou .csv.'); return; }

  let buffer;
  try { buffer = await arquivo.arrayBuffer(); }
  catch(e) { toast('❌ Não consegui ler o arquivo.'); return; }

  const texto = decodificarArquivoOFX(buffer); // mesma detecção de encoding serve p/ CSV

  let transacoes, cabecalho, tipoArquivo;
  if (ehOFX) {
    if (!/<OFX>/i.test(texto)) { toast('❌ Arquivo não parece ser um OFX válido.'); return; }
    transacoes = parseOFX(texto);
    tipoArquivo = 'ofx';
    const org = extrairOrgOFX(texto);
    cabecalho = 'ofx' + (org ? ':' + org : '');
  } else {
    transacoes = parseCSV(texto);
    tipoArquivo = 'csv';
    cabecalho = (texto.split(/\r\n|\r|\n/)[0] || '');
  }

  if (!transacoes.length) { toast('❌ Não consegui reconhecer nenhuma transação nesse arquivo.'); return; }

  if (transacoes.length > LIMITE_TRANSACOES_AVISO) {
    const continuar = confirm(`Seu extrato tem ${transacoes.length} transações. Para melhor performance, importe períodos menores (ex: por mês).\n\nContinuar mesmo assim?`);
    if (!continuar) return;
  }

  importacaoEstado = { transacoes, cabecalho, tipoArquivo, fonteNome: null, periodoInicio: null, periodoFim: null };

  const fonteConhecida = detectarFonte(cabecalho);
  if (fonteConhecida) abrirConfirmacaoFonteConhecida(fonteConhecida);
  else abrirConfirmacaoFonteNova();
};

function mostrarFaseConfirmacao(fase) {
  ['fonte-conhecida', 'fonte-nova', 'periodo'].forEach(f => {
    const el = document.getElementById('imp-conf-fase-' + f);
    if (el) el.style.display = f === fase ? '' : 'none';
  });
}

function abrirConfirmacaoFonteConhecida(nome) {
  importacaoEstado.fonteNome = nome;
  document.getElementById('imp-conf-fonte-conhecida-nome').textContent = nome;
  mostrarFaseConfirmacao('fonte-conhecida');
  abrirOverlay('overlay-importacao-confirmacao');
}

function abrirConfirmacaoFonteNova() {
  document.getElementById('imp-conf-fonte-nome-input').value = '';
  mostrarFaseConfirmacao('fonte-nova');
  abrirOverlay('overlay-importacao-confirmacao');
}

window.confirmarFonteConhecidaSim = function() {
  avancarParaConfirmacaoPeriodo();
};

window.confirmarFonteConhecidaNao = function() {
  document.getElementById('imp-conf-fonte-nome-input').value = '';
  mostrarFaseConfirmacao('fonte-nova');
};

window.confirmarFonteNova = function() {
  const nome = document.getElementById('imp-conf-fonte-nome-input').value.trim();
  if (!nome) { toast('Digite um nome para essa fonte.'); return; }
  importacaoEstado.fonteNome = nome;
  salvarFonte(importacaoEstado.cabecalho, nome, importacaoEstado.tipoArquivo);
  avancarParaConfirmacaoPeriodo();
};

function fmtDataBR(iso) {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR');
}

function avancarParaConfirmacaoPeriodo() {
  const datas = importacaoEstado.transacoes.map(t => t.data).sort();
  importacaoEstado.periodoInicio = datas[0];
  importacaoEstado.periodoFim = datas[datas.length - 1];
  document.getElementById('imp-conf-periodo-texto').textContent =
    `Encontrei ${importacaoEstado.transacoes.length} transações de ${fmtDataBR(importacaoEstado.periodoInicio)} a ${fmtDataBR(importacaoEstado.periodoFim)}. Importar?`;
  mostrarFaseConfirmacao('periodo');
}

window.confirmarImportarPeriodo = function() {
  fecharOverlay('overlay-importacao-confirmacao');
  abrirRevisao(importacaoEstado.transacoes);
};

window.cancelarImportacao = function() {
  fecharOverlay('overlay-importacao-confirmacao');
  importacaoEstado = null;
};

// ── TELA DE REVISÃO ────────────────────────────────────────────
// Estado da revisão em andamento — populado por abrirRevisao(), lido e
// mutado pelos handlers de checkbox/dropdown/filtro abaixo.
let revisaoTransacoes = [];
let revisaoFiltro = 'todos';
let revisaoCategorias = { gasto: [], receita: [] };

// Mini-form inline de "+ Nova categoria" — só uma transação por vez tem o
// form aberto (idx na lista completa, não na filtrada).
const CATEGORIA_NOVA_SENTINELA = '__nova__';
const EMOJIS_CATEGORIA_NOVA = ['🏠', '🍔', '🚗', '💊', '📚', '🎮', '🛍️', '✈️', '💡', '🏦'];
let novaCategoriaAbertaIdx = null;
let novaCategoriaEmojiSelecionado = EMOJIS_CATEGORIA_NOVA[0];

// Normaliza descrições, verifica duplicatas contra o Controle Financeiro
// (sem query extra — getCFLancamentos() já usa cache.controle) e categoriza
// em camadas (cache aprendido → extrato → IA, com barra de progresso),
// depois renderiza a lista de revisão.
async function abrirRevisao(transacoes) {
  abrirOverlay('overlay-importacao-revisao');

  const subtitulo = document.getElementById('importacao-revisao-subtitulo');
  if (subtitulo) subtitulo.textContent = `${importacaoEstado?.fonteNome || ''} · ${fmtDataBR(importacaoEstado?.periodoInicio)} a ${fmtDataBR(importacaoEstado?.periodoFim)}`;

  const progressoEl = document.getElementById('importacao-progresso');
  const corpoEl = document.getElementById('importacao-revisao-corpo');
  if (corpoEl) corpoEl.style.display = 'none';
  if (progressoEl) { progressoEl.style.display = ''; progressoEl.innerHTML = '<span class="spinner"></span> Preparando revisão...'; }

  let processadas = transacoes.map(t => ({ ...t, descricaoNormalizada: normalizarDescricao(t.descricao) }));

  let lancamentosExistentes = [];
  try { lancamentosExistentes = await getCFLancamentos(); } catch(e) {}
  processadas = verificarDuplicatas(processadas, lancamentosExistentes);
  processadas = processadas.map(t => ({ ...t, selecionado: t.status !== 'duplicata_exata' }));

  processadas = await categorizarTransacoes(processadas, (atual, total) => {
    if (progressoEl) progressoEl.innerHTML = `<span class="spinner"></span> Categorizando ${atual} de ${total} transações...`;
  });

  try { processadas = await detectarIntegracoes(processadas); } catch(e) { console.error('detectarIntegracoes', e); }

  try { revisaoCategorias = await getCFCategorias(); } catch(e) { revisaoCategorias = { gasto: [], receita: [] }; }

  revisaoTransacoes = processadas;
  revisaoFiltro = 'todos';

  if (progressoEl) progressoEl.style.display = 'none';
  if (corpoEl) corpoEl.style.display = '';
  const selTodos = document.getElementById('importacao-sel-todos');
  const selSoNovos = document.getElementById('importacao-sel-so-novos');
  if (selTodos) selTodos.checked = false;
  if (selSoNovos) selSoNovos.checked = false;
  filtrarRevisaoImportacao('todos');
}
window.abrirRevisao = abrirRevisao;

function transacoesFiltradasRevisao() {
  if (revisaoFiltro === 'novos') return revisaoTransacoes.filter(t => t.status === 'novo');
  if (revisaoFiltro === 'duplicatas') return revisaoTransacoes.filter(t => t.status === 'duplicata_exata' || t.status === 'conflito');
  return revisaoTransacoes;
}

function badgeStatusRevisao(t) {
  if (t.status === 'duplicata_exata') return { label: '⚠️ Duplicata', cls: 'badge-amber' };
  if (t.status === 'conflito') return { label: '⚠️ Conflito', cls: 'badge-amber' };
  if (t.revisar) return { label: '⚠️ Verificar', cls: 'badge-amber' };
  return { label: '✅ Novo', cls: 'badge-green' };
}

function opcoesCategoriaRevisao(t) {
  const lista = t.tipo === 'receita' ? (revisaoCategorias.receita || []) : (revisaoCategorias.gasto || []);
  const opcoes = lista.map(c => `<option value="${c.id}" ${c.id === t.categoria ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
  return opcoes + `<option value="${CATEGORIA_NOVA_SENTINELA}">+ Nova categoria</option>`;
}

// Mini-form inline de criação de categoria, renderizado só na linha cuja
// idx bate com novaCategoriaAbertaIdx.
function novaCategoriaFormHtml(idx) {
  const emojisHtml = EMOJIS_CATEGORIA_NOVA.map(e => {
    const selecionado = e === novaCategoriaEmojiSelecionado;
    const estilo = selecionado
      ? 'font-size:16px;padding:4px 7px;border-radius:8px;border:2px solid var(--eko-green);background:var(--eko-green-light);cursor:pointer'
      : 'font-size:16px;padding:4px 7px;border-radius:8px;border:2px solid var(--border);background:var(--surface);cursor:pointer';
    return `<button type="button" onclick="selecionarEmojiNovaCategoria(this,'${e}')" style="${estilo}">${e}</button>`;
  }).join('');
  return `<div style="margin-top:6px;background:var(--surface2);border-radius:10px;padding:8px 10px">
    <div class="field" style="margin-bottom:.5rem"><label style="font-size:11px">Nome da categoria</label><input type="text" id="importacao-nova-cat-nome" placeholder="Ex: Pet" style="font-size:12px;padding:.4rem .6rem"></div>
    <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:.5rem">${emojisHtml}</div>
    <div id="importacao-nova-cat-msg" class="msg"></div>
    <div style="display:flex;gap:6px">
      <button onclick="confirmarNovaCategoriaRevisao(${idx})" class="btn btn-sm btn-primary" style="flex:1;padding:.4rem">Criar</button>
      <button onclick="cancelarNovaCategoriaRevisao()" class="btn btn-sm" style="flex:1;padding:.4rem;background:var(--surface);border:1px solid var(--border)">Cancelar</button>
    </div>
  </div>`;
}

function renderListaRevisao() {
  const lista = document.getElementById('importacao-revisao-lista');
  if (!lista) return;
  const itens = transacoesFiltradasRevisao();

  if (!itens.length) {
    lista.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:13px">Nenhuma transação neste filtro.</div>';
  } else {
    lista.innerHTML = itens.map(t => {
      const idx = revisaoTransacoes.indexOf(t);
      const badge = badgeStatusRevisao(t);
      const valorFmt = (t.valor < 0 ? '-' : '+') + fmt(Math.abs(t.valor));
      const sugestao = t.sugestaoIntegracao;
      const sugestaoHtml = (sugestao && !sugestao.resolvida) ? `
        <div style="margin-top:6px;background:var(--amber-light);border-radius:10px;padding:8px 10px">
          <div style="margin-bottom:6px;color:#7A4010;font-weight:600;font-size:12px">${esc(sugestao.mensagem)}</div>
          <div style="display:flex;gap:6px">
            <button onclick="responderSugestaoIntegracao(${idx},true)" class="btn btn-sm btn-primary" style="flex:1;padding:.35rem">Sim</button>
            <button onclick="responderSugestaoIntegracao(${idx},false)" class="btn btn-sm" style="flex:1;padding:.35rem;background:var(--surface);border:1px solid var(--border)">Não</button>
          </div>
        </div>` : (t.vinculoModulo ? `<div style="margin-top:4px;font-size:11px;color:var(--eko-green);font-weight:600">🔗 Vinculado</div>` : '');
      return `<div class="pront-item" style="align-items:flex-start;margin-bottom:6px">
        <div style="display:flex;align-items:flex-start;gap:10px;flex:1;min-width:0">
          <input type="checkbox" ${t.selecionado ? 'checked' : ''} onchange="toggleSelecaoRevisao(${idx},this.checked)" style="margin-top:5px;flex-shrink:0">
          <div style="flex:1;min-width:0">
            <div style="display:flex;justify-content:space-between;gap:8px">
              <span style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fmtDataBR(t.data)} · ${esc(t.descricaoNormalizada)}</span>
              <span style="font-size:13px;font-weight:800;white-space:nowrap;color:${t.valor < 0 ? 'var(--red)' : 'var(--eko-green)'}">${valorFmt}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:5px;flex-wrap:wrap">
              <select onchange="alterarCategoriaRevisao(${idx},this.value)" class="input" style="font-size:11px;padding:3px 6px;width:auto">${opcoesCategoriaRevisao(t)}</select>
              <span class="badge ${badge.cls}">${badge.label}</span>
            </div>
            ${novaCategoriaAbertaIdx === idx ? novaCategoriaFormHtml(idx) : ''}
            ${sugestaoHtml}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  atualizarContadorRevisao();
}

function atualizarContadorRevisao() {
  const total = revisaoTransacoes.length;
  const selecionadas = revisaoTransacoes.filter(t => t.selecionado).length;
  const contadorEl = document.getElementById('importacao-revisao-contador');
  if (contadorEl) contadorEl.textContent = `${selecionadas} de ${total} transações selecionadas`;
  const btnEl = document.getElementById('importacao-btn-confirmar');
  if (btnEl) btnEl.textContent = `Confirmar ${selecionadas} selecionada${selecionadas === 1 ? '' : 's'}`;
}

window.toggleSelecaoRevisao = function(idx, checked) {
  if (revisaoTransacoes[idx]) revisaoTransacoes[idx].selecionado = checked;
  atualizarContadorRevisao();
};

window.alterarCategoriaRevisao = function(idx, categoriaId) {
  if (categoriaId === CATEGORIA_NOVA_SENTINELA) {
    novaCategoriaAbertaIdx = idx;
    novaCategoriaEmojiSelecionado = EMOJIS_CATEGORIA_NOVA[0];
    renderListaRevisao(); // o <select> volta a mostrar a categoria anterior; o mini-form abre abaixo dele
    return;
  }
  if (revisaoTransacoes[idx]) revisaoTransacoes[idx].categoria = categoriaId;
};

window.selecionarEmojiNovaCategoria = function(btn, emoji) {
  novaCategoriaEmojiSelecionado = emoji;
  btn.parentElement.querySelectorAll('button').forEach(b => {
    b.style.border = '2px solid var(--border)'; b.style.background = 'var(--surface)';
  });
  btn.style.border = '2px solid var(--eko-green)'; btn.style.background = 'var(--eko-green-light)';
};

window.cancelarNovaCategoriaRevisao = function() {
  novaCategoriaAbertaIdx = null;
  renderListaRevisao();
};

// Salva a categoria permanentemente (mesmo saveCFCategorias() do fluxo
// "Gerenciar categorias" do Controle Financeiro), seleciona ela na
// transação que abriu o form e fecha o mini-form. getCFCategorias() não
// tem camada de cache própria hoje (só lê o doc do usuário direto) —
// não há nada de 'cache de categorias' pra invalidar; revisaoCategorias
// (o objeto local já carregado nesta revisão) é atualizado na hora, então
// as outras transações já veem a categoria nova no dropdown delas também.
window.confirmarNovaCategoriaRevisao = async function(idx) {
  const nomeInput = document.getElementById('importacao-nova-cat-nome');
  const msgEl = document.getElementById('importacao-nova-cat-msg');
  const nome = (nomeInput?.value || '').trim();
  if (!nome) { if (msgEl) { msgEl.className = 'msg error'; msgEl.textContent = 'Digite um nome para a categoria.'; } return; }

  const t = revisaoTransacoes[idx];
  if (!t) return;
  const tipoLista = t.tipo === 'receita' ? 'receita' : 'gasto';
  revisaoCategorias[tipoLista] = revisaoCategorias[tipoLista] || [];

  const duplicada = revisaoCategorias[tipoLista].some(c => {
    const nomeSemEmoji = c.nome.replace(/^\S+\s*/, '').trim();
    return nomeSemEmoji.toLowerCase() === nome.toLowerCase();
  });
  if (duplicada) { if (msgEl) { msgEl.className = 'msg error'; msgEl.textContent = 'Já existe uma categoria com esse nome.'; } return; }

  const id = 'custom-' + Date.now();
  revisaoCategorias[tipoLista].push({ id, nome: `${novaCategoriaEmojiSelecionado} ${nome}`, visivel: true, padrao: false });

  try {
    await saveCFCategorias(revisaoCategorias);
  } catch(e) {
    console.error('confirmarNovaCategoriaRevisao', e);
    if (msgEl) { msgEl.className = 'msg error'; msgEl.textContent = 'Erro ao salvar categoria.'; }
    return;
  }

  t.categoria = id;
  novaCategoriaAbertaIdx = null;
  toast('✅ Categoria criada!');
  renderListaRevisao();
};

window.responderSugestaoIntegracao = async function(idx, aceitar) {
  const t = revisaoTransacoes[idx];
  if (!t || !t.sugestaoIntegracao) return;
  if (aceitar) {
    try {
      const vinculo = await aplicarIntegracao(t.sugestaoIntegracao, Math.abs(t.valor));
      if (vinculo) { t.vinculoModulo = vinculo; toast('✅ Vínculo aplicado!'); }
      else toast('❌ Não consegui aplicar o vínculo. Você pode fazer isso depois pela tela normal.');
    } catch(e) {
      console.error('responderSugestaoIntegracao', e);
      toast('❌ Erro ao aplicar o vínculo.');
    }
  }
  t.sugestaoIntegracao.resolvida = true;
  renderListaRevisao();
};

window.toggleSelecionarTodosImportacao = function(checkbox) {
  revisaoTransacoes.forEach(t => { t.selecionado = checkbox.checked; });
  const soNovos = document.getElementById('importacao-sel-so-novos');
  if (soNovos) soNovos.checked = false;
  renderListaRevisao();
};

window.toggleSoNovosImportacao = function(checkbox) {
  if (checkbox.checked) {
    revisaoTransacoes.forEach(t => { t.selecionado = t.status === 'novo'; });
    const todos = document.getElementById('importacao-sel-todos');
    if (todos) todos.checked = false;
  }
  renderListaRevisao();
};

window.filtrarRevisaoImportacao = function(filtro) {
  revisaoFiltro = filtro;
  ['todos', 'novos', 'duplicatas'].forEach(f => {
    const btn = document.getElementById('importacao-filtro-' + f);
    if (!btn) return;
    if (f === filtro) { btn.className = 'btn btn-sm btn-primary'; btn.style.cssText = 'flex:1'; }
    else { btn.className = 'btn btn-sm'; btn.style.cssText = 'flex:1;background:var(--surface);border:1px solid var(--border);color:var(--text)'; }
  });
  renderListaRevisao();
};

window.confirmarRevisaoImportacao = async function() {
  const selecionadas = revisaoTransacoes.filter(t => t.selecionado);
  if (!selecionadas.length) { toast('Selecione ao menos uma transação.'); return; }

  const msgEl = document.getElementById('importacao-revisao-msg');
  const btnEl = document.getElementById('importacao-btn-confirmar');
  if (msgEl) { msgEl.className = 'msg'; msgEl.textContent = 'Salvando...'; }
  if (btnEl) btnEl.disabled = true;

  try {
    await confirmarImportacao(selecionadas, importacaoEstado?.fonteNome || 'Desconhecida', {
      inicio: importacaoEstado?.periodoInicio,
      fim: importacaoEstado?.periodoFim,
      total: importacaoEstado?.transacoes?.length || selecionadas.length,
    });
    fecharOverlay('overlay-importacao-revisao');
    toast(`✅ ${selecionadas.length} transação(ões) importada(s)!`);
    revisaoTransacoes = [];
    importacaoEstado = null;
    renderHistoricoImportacoes();
    renderDashboard(importacaoMesVis, importacaoAnoVis);
  } catch(e) {
    console.error('confirmarRevisaoImportacao', e);
    if (msgEl) { msgEl.className = 'msg error'; msgEl.textContent = 'Erro ao salvar. Tente novamente.'; }
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
};

window.cancelarRevisaoImportacao = function() {
  fecharOverlay('overlay-importacao-revisao');
  revisaoTransacoes = [];
  importacaoEstado = null;
};

// ── GRAVAÇÃO ────────────────────────────────────────────────────
// Grava atomicamente (writeBatch) todos os lançamentos aprovados no
// Controle Financeiro, salva a entrada no histórico local e atualiza o
// aprendizado de categorias — só para as transações que o usuário de fato
// confirmou (nunca aprende com algo que ele possa ter rejeitado).
async function confirmarImportacao(transacoesSelecionadas, fonte, periodo) {
  const importacaoId = crypto.randomUUID();
  const batch = writeBatch(db);

  transacoesSelecionadas.forEach(t => {
    const dataObj = new Date(t.data + 'T12:00:00');
    const lancamento = {
      tipo: t.tipo,
      valor: Math.abs(t.valor),
      categoria: t.categoria,
      mes: dataObj.getMonth(),
      ano: dataObj.getFullYear(),
      chaveMes: cfChaveMes(dataObj.getFullYear(), dataObj.getMonth()),
      data: dataObj.toISOString(),
      email: store.sessao.email,
      criadoEm: new Date().toISOString(),
      importacaoId,
      hash: t.hash || gerarHash(t),
    };
    if (t.vinculoModulo) lancamento.vinculoModulo = t.vinculoModulo;
    batch.set(doc(collection(db, 'controle')), lancamento);
  });

  await batch.commit();

  const historico = getHistoricoImportacoes();
  historico.unshift({
    id: importacaoId,
    fonte,
    periodo_inicio: periodo?.inicio || null,
    periodo_fim: periodo?.fim || null,
    total_transacoes: periodo?.total ?? transacoesSelecionadas.length,
    aprovadas: transacoesSelecionadas.length,
    importado_em: new Date().toISOString(),
  });
  localStorage.setItem(HISTORICO_KEY, JSON.stringify(historico));

  transacoesSelecionadas.forEach(t => {
    if (t.categoria) salvarCatAprendida(t.descricaoNormalizada, t.categoria);
  });

  cache.invalidar('controle');

  return importacaoId;
}

// ── REVERSÃO ────────────────────────────────────────────────────
window.confirmarDesfazerImportacao = async function(importacaoId) {
  if (!confirm('Desfazer esta importação? Isso remove todos os lançamentos criados por ela do Controle Financeiro (e reverte pagamentos de dívida/meta/reserva vinculados, se houver).')) return;
  try {
    const removidos = await desfazerImportacao(importacaoId);
    toast(`🗑️ Importação desfeita. ${removidos} lançamento(s) removido(s).`);
    renderHistoricoImportacoes();
    renderDashboard(importacaoMesVis, importacaoAnoVis);
  } catch(e) {
    console.error('confirmarDesfazerImportacao', e);
    toast('❌ Erro ao desfazer a importação.');
  }
};

// Busca todos os lançamentos com esse importacaoId, desfaz os vínculos com
// Dívidas/Metas/Reserva de cada um (campo vinculoModulo) e remove tudo em
// lote — depois tira a entrada correspondente do histórico local.
async function desfazerImportacao(importacaoId) {
  const q = query(collection(db, 'controle'), where('email', '==', store.sessao.email), where('importacaoId', '==', importacaoId));
  const snap = await getDocs(q);
  const lancamentos = [];
  snap.forEach(d => lancamentos.push({ ...d.data(), _id: d.id }));

  for (const l of lancamentos) {
    if (l.vinculoModulo) {
      try { await reverterIntegracao(l.vinculoModulo); } catch(e) { console.error('reverterIntegracao', e); }
    }
  }

  const batch = writeBatch(db);
  lancamentos.forEach(l => batch.delete(doc(db, 'controle', l._id)));
  await batch.commit();

  const historico = getHistoricoImportacoes().filter(h => h.id !== importacaoId);
  localStorage.setItem(HISTORICO_KEY, JSON.stringify(historico));

  cache.invalidar('controle');

  return lancamentos.length;
}

// ── GUIA DE EXPORTAÇÃO POR BANCO ──────────────────────────────
// Só o Nubank tem passo a passo verificado (dado pronto). Os demais bancos
// mostram a mesma orientação genérica — não temos confirmação dos rótulos
// atuais de menu/botão de cada app pra apresentar como passo a passo
// confiável; preferimos isso a arriscar instruções erradas.
const GUIA_EXPORTACAO_NUBANK = [
  'Abra o app do Nubank',
  'Toque em "Configurações" (ícone ⚙️)',
  'Selecione "Exportar dados"',
  'Escolha o período e toque em "Exportar CSV"',
  'Salve o arquivo e importe aqui',
];
const NOMES_BANCOS_GUIA = { nubank: 'Nubank', itau: 'Itaú', bradesco: 'Bradesco', santander: 'Santander', inter: 'Banco Inter', c6: 'C6 Bank', outro: 'Outro banco' };
const MENSAGEM_GUIA_GENERICA = 'Ainda não temos o passo a passo específico deste banco. Procure por "exportar extrato" nas configurações do app do seu banco — geralmente em Extrato, Configurações ou Central de ajuda — e baixe no formato OFX ou CSV pra importar aqui.';

window.mostrarGuiaBanco = function(banco) {
  Object.keys(NOMES_BANCOS_GUIA).forEach(b => {
    const btn = document.getElementById('importacao-guia-btn-' + b);
    if (!btn) return;
    const spanOutro = b === 'outro' ? 'grid-column:span 3;' : '';
    if (b === banco) { btn.className = 'btn btn-sm btn-primary'; btn.style.cssText = spanOutro; }
    else { btn.className = 'btn btn-sm'; btn.style.cssText = `background:var(--surface);border:1px solid var(--border);color:var(--text);${spanOutro}`; }
  });

  const el = document.getElementById('importacao-guia-conteudo');
  if (!el) return;
  const nome = NOMES_BANCOS_GUIA[banco] || banco;

  if (banco === 'nubank') {
    el.innerHTML = `<div style="font-size:13px;font-weight:700;margin-bottom:.5rem">${esc(nome)}:</div>
      <ol style="font-size:13px;color:var(--text-muted);line-height:1.9;padding-left:1.25rem;margin:0">${GUIA_EXPORTACAO_NUBANK.map(p => `<li>${esc(p)}</li>`).join('')}</ol>`;
  } else {
    el.innerHTML = `<div style="font-size:13px;font-weight:700;margin-bottom:.5rem">${esc(nome)}:</div>
      <div style="font-size:13px;color:var(--text-muted);line-height:1.7">${esc(MENSAGEM_GUIA_GENERICA)}</div>`;
  }
};
