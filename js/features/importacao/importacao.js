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
import { toast } from '../../utils/dom.js';

const ONBOARDING_KEY = 'eko_importacao_onboarding';
const HISTORICO_KEY = 'eko_importacoes';

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
