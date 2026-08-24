/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/importacao/importacao.js
 * Importação de Extrato — ponto de entrada do módulo: onboarding,
 * navegação (#screen-importacao), histórico de importações
 * (localStorage) e orquestração dos demais arquivos deste módulo
 * (parsers, normalizer, deduplicator, categorizer, integrations).
 * Processamento 100% local — nenhum dado bancário é enviado ao
 * servidor ou ao Firestore.
 *
 * Formato de cada entrada de 'eko_importacoes' (localStorage,
 * array JSON) — escrito pelos grupos seguintes deste módulo:
 *   { fonte, periodoInicio (YYYY-MM-DD), periodoFim (YYYY-MM-DD),
 *     aprovadas (nº de transações), data (ISO — quando foi importado) }
 * ═══════════════════════════════════════════════════════════ */

import { ir } from '../../core/router.js';
import { fmt, esc } from '../../utils/format.js';
import { toast, abrirOverlay, fecharOverlay } from '../../utils/dom.js';
import { parseOFX, decodificarArquivoOFX, extrairOrgOFX } from './parser-ofx.js';
import { parseCSV } from './parser-csv.js';

const ONBOARDING_KEY = 'eko_importacao_onboarding';
const HISTORICO_KEY = 'eko_importacoes';
const FONTES_KEY = 'eko_importacao_fontes';
const LIMITE_TRANSACOES_AVISO = 500;

// ── ONBOARDING / NAVEGAÇÃO ───────────────────────────────────
window.abrirImportacao = function() {
  ir('screen-importacao');
  const onboardingFeito = localStorage.getItem(ONBOARDING_KEY);
  if (onboardingFeito) {
    mostrarConteudoImportacao();
  } else {
    document.getElementById('importacao-onboarding').style.display = '';
    document.getElementById('importacao-conteudo').style.display = 'none';
  }
};

window.concluirOnboarding = function() {
  localStorage.setItem(ONBOARDING_KEY, '1');
  mostrarConteudoImportacao();
};

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

  const itens = historico.map((imp, i) => {
    const dataFmt = imp.data ? new Date(imp.data).toLocaleDateString('pt-BR') : '';
    const inicioFmt = imp.periodoInicio ? new Date(imp.periodoInicio + 'T12:00:00').toLocaleDateString('pt-BR') : '';
    const fimFmt = imp.periodoFim ? new Date(imp.periodoFim + 'T12:00:00').toLocaleDateString('pt-BR') : '';
    return `<div class="pront-item" style="margin-bottom:6px">
      <div class="pront-item-left">
        <div class="pront-item-icon">📥</div>
        <div>
          <div class="pront-item-title">${esc(imp.fonte || 'Fonte desconhecida')}</div>
          <div class="pront-item-sub">${inicioFmt} a ${fimFmt} · ${imp.aprovadas || 0} transações · ${dataFmt}</div>
        </div>
      </div>
      <button onclick="desfazerImportacaoPlaceholder()" class="btn btn-sm" style="background:var(--surface);border:1px solid var(--border);color:var(--text-muted)">Desfazer</button>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="section-title" style="margin-bottom:8px">📥 Importações realizadas</div>${itens}`;
}

// Desfazer uma importação exige reverter os lançamentos criados no Controle
// Financeiro — fora do escopo desta Parte 1 (ver integrations.js). Por ora
// só avisa o usuário.
window.desfazerImportacaoPlaceholder = function() {
  toast('🚧 Desfazer chega na próxima parte deste módulo.');
};

// ── DASHBOARD (esqueleto — cálculo real vem na Parte 2) ──────
let importacaoMesVis = new Date().getMonth();
let importacaoAnoVis = new Date().getFullYear();

function inicializarDashboardImportacao() {
  importacaoMesVis = new Date().getMonth();
  importacaoAnoVis = new Date().getFullYear();
  renderDashboardImportacao();
}

function renderDashboardImportacao() {
  const mesEl = document.getElementById('importacao-mes-label');
  const anoEl = document.getElementById('importacao-ano-label');
  if (mesEl) mesEl.textContent = new Date(importacaoAnoVis, importacaoMesVis, 1).toLocaleDateString('pt-BR', {month:'long'}).replace(/^\w/, c => c.toUpperCase());
  if (anoEl) anoEl.textContent = importacaoAnoVis;

  const entradasEl = document.getElementById('importacao-entradas');
  const saidasEl = document.getElementById('importacao-saidas');
  const saldoEl = document.getElementById('importacao-saldo');
  if (entradasEl) entradasEl.textContent = fmt(0);
  if (saidasEl) saidasEl.textContent = fmt(0);
  if (saldoEl) { saldoEl.textContent = fmt(0); saldoEl.style.color = 'var(--eko-green)'; }

  // Breakdown por categoria — vazio até a Parte 2 (cálculo real das transações importadas)
  const catsEl = document.getElementById('importacao-categorias');
  if (catsEl) catsEl.innerHTML = '';
}

window.navegarMesImportacao = function(dir) {
  importacaoMesVis += dir;
  if (importacaoMesVis < 0) { importacaoMesVis = 11; importacaoAnoVis--; }
  if (importacaoMesVis > 11) { importacaoMesVis = 0; importacaoAnoVis++; }
  renderDashboardImportacao();
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

// A gravação de fato (deduplicação, categorização e criação dos
// lançamentos no Controle Financeiro) é a Parte 2 deste módulo — ver
// deduplicator.js, categorizer.js e integrations.js.
window.confirmarImportarPeriodo = function() {
  fecharOverlay('overlay-importacao-confirmacao');
  toast('🚧 A importação de fato (deduplicação, categorização e gravação) chega na Parte 2 deste módulo.');
  importacaoEstado = null;
};

window.cancelarImportacao = function() {
  fecharOverlay('overlay-importacao-confirmacao');
  importacaoEstado = null;
};
