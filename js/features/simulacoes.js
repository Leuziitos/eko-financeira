/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/simulacoes.js
 * Simulações de Aposentadoria e Acumulação: cálculo com taxa
 * real (Fisher), 3 cenários, custo de esperar, gráficos,
 * salvar (coleção 'simulacoes') e compartilhar. Também cria
 * meta a partir da acumulação (window._metaPreenchida +
 * window.abrirMetas/abrirCriarMeta registrados por metas.js).
 * renderProntuario via ponte window.* até a Fase 5.
 * Corpo movido verbatim; consts debounced preservadas ao final
 * (posição original, após as funções que referenciam).
 * ═══════════════════════════════════════════════════════════ */

import { db, collection, getDocs, addDoc, query, where } from '../core/firebase.js';
import { store } from '../core/store.js';
import { ir } from '../core/router.js';
import { logEko } from '../core/firebase.js';
import { fmt, fmtK } from '../utils/format.js';
import { parseMoney, setupMoneyInputs } from '../utils/money.js';
import { taxaReal, calcFV, calcPMTparaFV, irSobreJuros } from '../utils/finance-math.js';
import { debounce } from '../utils/debounce.js';
import { toast, btnDoClique, liberarBotao } from '../utils/dom.js';
import { renderProntuario } from './prontuario.js';

// ════════════════════════════════════════════════
// FASE 3 — SIMULAÇÕES (matemática completa)
// ════════════════════════════════════════════════

let simTabAtual = 'aposent';

window.switchSimTab = function(tab) {
  simTabAtual = tab;
  document.getElementById('tab-aposent').classList.toggle('active', tab === 'aposent');
  document.getElementById('tab-acum').classList.toggle('active', tab === 'acum');
  document.getElementById('sim-aposent').style.display = tab === 'aposent' ? '' : 'none';
  document.getElementById('sim-acum').style.display = tab === 'acum' ? '' : 'none';
};

// ── Helpers matemáticos → /js/utils/finance-math.js ──────

// Renderiza 3 cenários (conservador / base / otimista)
function render3Cenarios(idEl, calcFn) {
  const cenarios = [
    { label: '🐢 Conservador', rent: 0.5, cor: 'var(--amber)' },
    { label: '⚖️ Moderado',    rent: 1.0, cor: 'var(--eko-green)' },
    { label: '🚀 Otimista',    rent: 1.5, cor: 'var(--purple)' },
  ];
  document.getElementById(idEl).innerHTML = cenarios.map(c => {
    const { label1, label2, val1, val2 } = calcFn(c.rent);
    return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="font-size:13px;font-weight:700;color:var(--text)">${label} <span style="font-size:11px;font-weight:500;color:var(--text-muted)">${c.rent}%/m</span></div>
        <div style="font-size:14px;font-weight:800;color:${c.cor}">${val1}</div>
      </div>
      <div style="font-size:11px;color:var(--text-muted)">${label1}: <strong>${val1}</strong> · ${label2}: <strong>${val2}</strong></div>
    </div>`;
  }).join('');
}

// Renderiza impacto de atrasar (hoje / +1 ano / +5 anos)
function renderImpactoAtraso(idEl, calcFn) {
  const casos = [
    { label: '✅ Começar hoje',   delta: 0  },
    { label: '⚠️ Esperar 1 ano', delta: 12 },
    { label: '🔴 Esperar 5 anos', delta: 60 },
  ];
  const base = calcFn(0);
  document.getElementById(idEl).innerHTML = casos.map((c, i) => {
    const res = calcFn(c.delta);
    const diff = i === 0 ? '' : ` <span style="color:var(--red);font-size:11px">(+${fmt(res.custo - base.custo)}/mês)</span>`;
    return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:11px 14px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:13px;font-weight:600;color:var(--text)">${c.label}</div>
      <div style="text-align:right"><div style="font-size:14px;font-weight:800;color:${i===0?'var(--eko-green)':i===1?'var(--amber)':'var(--red)'}">${fmt(res.custo)}/mês</div>${diff}</div>
    </div>`;
  }).join('');
}

// ── APOSENTADORIA ─────────────────────────────────────
window.calcularAposentadoria = function() {
  const idadeAtual  = parseInt(document.getElementById('ap-idade').value) || 0;
  const idadeAposent= parseInt(document.getElementById('ap-idade-aposent').value) || 65;
  const rendaHoje   = parseMoney(document.getElementById('ap-renda').value) || 0;
  const patrimonioAtual = parseMoney(document.getElementById('ap-patrimonio').value) || 0;
  const rent  = parseFloat(document.getElementById('ap-rent').value) || 1.0;
  const infl  = parseFloat(document.getElementById('ap-infl').value) || 0.4;
  const aliqIR= parseFloat(document.getElementById('ap-ir').value)  || 15;

  if (!idadeAtual || !rendaHoje || idadeAposent <= idadeAtual) {
    document.getElementById('ap-resultado').style.display = 'none'; return;
  }

  const anos  = idadeAposent - idadeAtual;
  const meses = anos * 12;
  const r     = taxaReal(rent, infl);   // taxa real mensal

  // Patrimônio alvo em R$ de hoje (regra dos 4% adaptada à taxa real)
  // renda anual / taxa real anual = capital necessário
  const rateAnual = Math.pow(1 + r, 12) - 1;
  const patrimonioAlvo = rendaHoje * 12 / Math.max(0.01, rateAnual);

  // PMT mensal para acumular (usando taxa real, já descontada inflação)
  const pmt = calcPMTparaFV(patrimonioAlvo, patrimonioAtual, r, meses);

  // Detalhamento
  const totalInvestido = patrimonioAtual + pmt * meses;
  const bruto = calcFV(patrimonioAtual, pmt, r, meses);
  const irVal  = irSobreJuros(bruto, totalInvestido, aliqIR);
  const liquido= bruto - irVal;

  // Preencher card principal
  document.getElementById('ap-patrimonio-alvo').textContent = fmt(patrimonioAlvo);
  document.getElementById('ap-renda-show').textContent = fmt(rendaHoje);
  document.getElementById('ap-taxa-real').textContent = (r * 100).toFixed(2);
  document.getElementById('ap-pmt-mensal').textContent = fmt(pmt);
  document.getElementById('ap-prazo-anos').textContent = anos + ' anos';
  document.getElementById('ap-total-investido').textContent = fmt(totalInvestido);
  document.getElementById('ap-juros-brutos').textContent = fmt(Math.max(0, bruto - totalInvestido));
  document.getElementById('ap-ir-valor').textContent = fmt(irVal);
  document.getElementById('ap-liquido').textContent = fmt(liquido);

  // Viabilidade
  const rendaUsuario = store.sessao.renda || 0;
  let viabHtml = '';
  if (rendaUsuario > 0) {
    const pct = Math.round((pmt / rendaUsuario) * 100);
    const cor = pct > 30 ? 'var(--red)' : pct > 20 ? 'var(--amber)' : 'var(--eko-green)';
    const icone = pct > 30 ? '⚠️' : pct > 20 ? '💛' : '✅';
    viabHtml = `<div style="background:var(--surface2);border-radius:12px;padding:12px 14px;border-left:3px solid ${cor};font-size:13px;font-weight:600;color:var(--text);margin-bottom:1rem">${icone} Representa <span style="color:${cor}">${pct}% da sua renda</span>${pct > 30 ? ' — considere aumentar o prazo ou reduzir a renda desejada' : ' — dentro do possível!'}</div>`;
  }
  document.getElementById('ap-viabilidade').innerHTML = viabHtml;

  // 3 Cenários
  const ce = document.getElementById('ap-3cenarios');
  const cenarios = [
    { label: '🐢 Conservador', rent: 0.5, cor: 'var(--amber)' },
    { label: '⚖️ Moderado',    rent: 1.0, cor: 'var(--eko-green)' },
    { label: '🚀 Otimista',    rent: 1.5, cor: 'var(--purple)' },
  ];
  ce.innerHTML = cenarios.map(c => {
    const rC   = taxaReal(c.rent, infl);
    const raC  = Math.pow(1+rC,12)-1;
    const alvC = rendaHoje * 12 / Math.max(0.01, raC);
    const pmtC = calcPMTparaFV(alvC, patrimonioAtual, rC, meses);
    const taxaRealC = (rC * 100).toFixed(2);
    const jaCobre = pmtC <= 0;
    return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:11px 14px;margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div style="font-size:13px;font-weight:700;color:var(--text)">${c.label}</div>
        <div style="font-size:15px;font-weight:800;color:${jaCobre?'var(--eko-green)':c.cor}">${jaCobre ? '✅ Já coberto!' : fmt(pmtC)+'/mês'}</div>
      </div>
      <div style="font-size:11px;color:var(--text-muted)">
        Rentabilidade ${c.rent}%/m → taxa real <strong>${taxaRealC}%/m</strong> · Meta ${fmt(alvC)}
      </div>
      ${jaCobre ? '<div style="font-size:11px;color:var(--eko-green);margin-top:3px;font-weight:600">Seu patrimônio atual já cresce sozinho até a meta neste cenário 🎉</div>' : ''}
    </div>`;
  }).join('');

  // Impacto de atrasar
  const imp = document.getElementById('ap-impacto');
  const casos = [{label:'✅ Começar hoje',delta:0},{label:'⚠️ Esperar 1 ano',delta:12},{label:'🔴 Esperar 5 anos',delta:60}];
  const pmtBase = pmt;
  imp.innerHTML = casos.map((c, i) => {
    const n2 = Math.max(1, meses - c.delta);
    const pmt2 = calcPMTparaFV(patrimonioAlvo, patrimonioAtual, r, n2);
    const extra = pmt2 - pmtBase;
    return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:11px 14px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:13px;font-weight:600;color:var(--text)">${c.label}</div>
      <div style="text-align:right"><div style="font-size:14px;font-weight:800;color:${i===0?'var(--eko-green)':i===1?'var(--amber)':'var(--red)'}">${fmt(pmt2)}/mês</div>${i>0?`<div style="font-size:11px;color:var(--red)">+${fmt(extra)} a mais</div>`:''}</div>
    </div>`;
  }).join('');

  // Chart
  const step = Math.max(1, Math.floor(anos / 5));
  const marcos = [];
  for (let a = step; a <= anos; a += step) marcos.push({ a, v: calcFV(patrimonioAtual, pmt, r, a*12) });
  if (!marcos.length || marcos[marcos.length-1].a < anos) marcos.push({ a: anos, v: calcFV(patrimonioAtual, pmt, r, meses) });
  const maxV = Math.max(...marcos.map(m => m.v));
  document.getElementById('ap-chart').innerHTML = marcos.map(m => {
    const pct = Math.round((m.v / maxV) * 100);
    return `<div class="sim-chart-bar"><div class="sim-chart-bar-label">Ano ${m.a}</div><div class="sim-chart-bar-bg"><div class="sim-chart-bar-fill" style="width:${pct}%;background:linear-gradient(90deg,var(--eko-green),#5DCAA5)"></div></div><div class="sim-chart-bar-val" style="color:var(--eko-green)">${fmtK(m.v)}</div></div>`;
  }).join('');

  document.getElementById('ap-resultado').style.display = '';
  carregarHistoricoSimulacoes();
};

// ── ACUMULAÇÃO ────────────────────────────────────────
window.calcularAcumulacao = function() {
  const inicial = parseMoney(document.getElementById('ac-inicial').value) || 0;
  const aporte  = parseMoney(document.getElementById('ac-aporte').value) || 0;
  const anos    = parseInt(document.getElementById('ac-anos').value) || 0;
  const rent    = parseFloat(document.getElementById('ac-rent').value) || 1.0;
  const infl    = parseFloat(document.getElementById('ac-infl').value) || 0.4;
  const aliqIR  = parseFloat(document.getElementById('ac-ir').value)  || 15;

  if (!aporte || !anos) { document.getElementById('ac-resultado').style.display = 'none'; return; }

  const meses = anos * 12;
  const r     = taxaReal(rent, infl);
  const bruto = calcFV(inicial, aporte, r, meses);
  const investido = inicial + aporte * meses;
  const juros = Math.max(0, bruto - investido);
  const irVal = juros * (aliqIR / 100);
  const liquido = bruto - irVal;

  // Renda mensal gerada pelo patrimônio (juros reais sobre o líquido)
  const rendaMensal = liquido * r;

  document.getElementById('ac-total').textContent = fmt(bruto);
  document.getElementById('ac-liquido').textContent = fmt(liquido);
  document.getElementById('ac-renda-mensal').textContent = fmt(rendaMensal) + '/mês';
  document.getElementById('ac-investido').textContent = fmt(investido);
  document.getElementById('ac-juros').textContent = fmt(juros);
  document.getElementById('ac-ir-valor').textContent = fmt(irVal);
  document.getElementById('ac-taxa-real').textContent = (r*100).toFixed(2) + '%';
  document.getElementById('ac-aporte-show').textContent = fmt(aporte);
  document.getElementById('ac-anos-show').textContent = anos + (anos === 1 ? ' ano' : ' anos');

  // 3 Cenários
  const ce = document.getElementById('ac-3cenarios');
  const cenarios = [
    { label: '🐢 Conservador', rent: 0.5, cor: 'var(--amber)' },
    { label: '⚖️ Moderado',    rent: 1.0, cor: 'var(--eko-green)' },
    { label: '🚀 Otimista',    rent: 1.5, cor: 'var(--purple)' },
  ];
  ce.innerHTML = cenarios.map(c => {
    const rC = taxaReal(c.rent, infl);
    const taxaRealC = (rC * 100).toFixed(2);
    const bC = calcFV(inicial, aporte, rC, meses);
    const jC = Math.max(0, bC - investido);
    const lC = bC - jC * (aliqIR/100);
    const rendaC = lC * rC;
    return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:11px 14px;margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div style="font-size:13px;font-weight:700;color:var(--text)">${c.label}</div>
        <div style="text-align:right">
          <div style="font-size:15px;font-weight:800;color:${c.cor}">${fmtK(lC)}</div>
          <div style="font-size:10px;color:var(--text-muted)">líquido</div>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text-muted)">
        Rentabilidade ${c.rent}%/m → taxa real <strong>${taxaRealC}%/m</strong> · Renda gerada: ${fmt(rendaC)}/mês
      </div>
    </div>`;
  }).join('');

  // Impacto de atrasar
  const imp = document.getElementById('ac-impacto');
  const casos = [{label:'✅ Começar hoje',delta:0},{label:'⚠️ Esperar 1 ano',delta:12},{label:'🔴 Esperar 5 anos',delta:60}];
  const baseVal = liquido;
  imp.innerHTML = casos.map((c, i) => {
    const n2 = Math.max(1, meses - c.delta);
    const b2 = calcFV(inicial, aporte, r, n2);
    const j2 = Math.max(0, b2 - (inicial + aporte*n2));
    const l2 = b2 - j2*(aliqIR/100);
    const perdeu = baseVal - l2;
    return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:11px 14px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:13px;font-weight:600;color:var(--text)">${c.label}</div>
      <div style="text-align:right"><div style="font-size:14px;font-weight:800;color:${i===0?'var(--eko-green)':i===1?'var(--amber)':'var(--red)'}">${fmtK(l2)}</div>${i>0?`<div style="font-size:11px;color:var(--red)">−${fmtK(perdeu)} a menos</div>`:''}</div>
    </div>`;
  }).join('');

  // Chart
  const step = Math.max(1, Math.floor(anos / 10));
  const marcos = [];
  for (let a = step; a <= anos; a += step) {
    const m = a * 12;
    const bm = calcFV(inicial, aporte, r, m);
    const inv = inicial + aporte * m;
    marcos.push({ a, total: bm, investido: inv });
  }
  if (!marcos.length || marcos[marcos.length-1].a < anos) marcos.push({ a: anos, total: bruto, investido });
  const maxV = Math.max(...marcos.map(m => m.total));
  document.getElementById('ac-chart').innerHTML = marcos.map(m => {
    const pctT = Math.round((m.total / maxV) * 100);
    const pctI = Math.round((m.investido / maxV) * 100);
    return `<div class="sim-chart-bar"><div class="sim-chart-bar-label">Ano ${m.a}</div><div class="sim-chart-bar-bg" style="position:relative"><div class="sim-chart-bar-fill" style="width:${pctI}%;background:var(--border-strong);position:absolute;top:0;left:0;height:100%"></div><div class="sim-chart-bar-fill" style="width:${pctT}%;background:linear-gradient(90deg,var(--eko-green),#5DCAA5)"></div></div><div class="sim-chart-bar-val" style="color:var(--eko-green)">${fmtK(m.total)}</div></div>`;
  }).join('') + `<div style="font-size:11px;color:var(--text-muted);margin-top:6px;display:flex;gap:12px"><span style="color:var(--border-strong)">▬ Investido</span><span style="color:var(--eko-green)">▬ Total c/ juros</span></div>`;

  document.getElementById('ac-resultado').style.display = '';
  carregarHistoricoSimulacoes();
};

// ── Compartilhar simulações ───────────────────────────────
function compartilhar(texto) {
  if (navigator.share) {
    navigator.share({ text: texto, url: 'https://eko-financeira.netlify.app' })
      .then(() => logEko('simulacao_compartilhada'))
      .catch(() => {});
  } else {
    // Fallback — copia para área de transferência
    navigator.clipboard.writeText(texto + '\n\nhttps://eko-financeira.netlify.app')
      .then(() => toast('✅ Copiado! Cole no WhatsApp ou Instagram.'))
      .catch(() => toast('📋 Copie o texto manualmente.'));
    logEko('simulacao_compartilhada');
  }
}

window.compartilharSimulacaoAp = function() {
  const patrimonio = document.getElementById('ap-patrimonio-alvo').textContent;
  const pmt = document.getElementById('ap-pmt-mensal').textContent;
  const prazo = document.getElementById('ap-prazo-anos').textContent;
  const renda = document.getElementById('ap-renda-show').textContent;
  const texto = `📊 Fiz minha simulação de aposentadoria na Eko Financeira!

🏖️ Quero me aposentar com ${renda}/mês
💰 Preciso acumular ${patrimonio}
📅 Guardando ${pmt}/mês por ${prazo}

Planeje o seu futuro também! 🌱
👉 eko-financeira.netlify.app`;
  compartilhar(texto);
};

window.compartilharSimulacaoAc = function() {
  const total = document.getElementById('ac-total').textContent;
  const liquido = document.getElementById('ac-liquido').textContent;
  const aporte = document.getElementById('ac-aporte-show').textContent;
  const anos = document.getElementById('ac-anos-show').textContent;
  const renda = document.getElementById('ac-renda-mensal').textContent;
  const texto = `📊 Fiz minha simulação de acumulação na Eko Financeira!

💰 Guardando ${aporte}/mês por ${anos}
📈 Vou acumular ${total} (${liquido} líquido)
🏦 Gerando ${renda} de renda passiva

Faça a sua simulação também! 🌱
👉 eko-financeira.netlify.app`;
  compartilhar(texto);
};
window.criarMetaDeAcumulacao = function() {
  const aporte = parseMoney(document.getElementById('ac-aporte').value) || 0;
  const anos   = parseInt(document.getElementById('ac-anos').value) || 0;
  const meses  = anos * 12;
  const r      = taxaReal(parseFloat(document.getElementById('ac-rent').value)||1, parseFloat(document.getElementById('ac-infl').value)||0.4);
  const inicial= parseMoney(document.getElementById('ac-inicial').value) || 0;
  const aliqIR = parseFloat(document.getElementById('ac-ir').value) || 15;
  const bruto  = calcFV(inicial, aporte, r, meses);
  const juros  = Math.max(0, bruto - (inicial + aporte*meses));
  const liquido= bruto - juros*(aliqIR/100);

  // Pré-preencher a tela de metas
  window._metaPreenchida = { valor: Math.round(liquido), meses, mensal: aporte };
  toast('🎯 Abrindo Metas Financeiras...');
  setTimeout(async () => {
    await abrirMetas();
    setTimeout(() => {
      abrirCriarMeta();
      if (window._metaPreenchida) {
        document.getElementById('meta-valor').value = window._metaPreenchida.valor;
        document.getElementById('meta-meses').value = window._metaPreenchida.meses;
        window._metaPreenchida = null;
      }
    }, 300);
  }, 400);
};

// ── Salvar no Firestore ───────────────────────────────
window.salvarSimulacaoAp = async function() {
  const btn = btnDoClique(); if (btn) btn.disabled = true;
  try {
  const idadeAtual   = parseInt(document.getElementById('ap-idade').value) || 0;
  const idadeAposent = parseInt(document.getElementById('ap-idade-aposent').value) || 65;
  const rendaMensal  = parseMoney(document.getElementById('ap-renda').value) || 0;
  const patrimonioAtual = parseMoney(document.getElementById('ap-patrimonio').value) || 0;
  const rent  = parseFloat(document.getElementById('ap-rent').value) || 1.0;
  const infl  = parseFloat(document.getElementById('ap-infl').value) || 0.4;
  const aliqIR= parseFloat(document.getElementById('ap-ir').value)  || 15;
  const anos  = idadeAposent - idadeAtual;
  const meses = anos * 12;
  const r     = taxaReal(rent, infl);
  const ra    = Math.pow(1+r,12)-1;
  const patrimonioAlvo = rendaMensal * 12 / Math.max(0.01, ra);
  const pmt   = calcPMTparaFV(patrimonioAlvo, patrimonioAtual, r, meses);
  await addDoc(collection(db,'simulacoes'), { tipo:'aposentadoria', email:store.sessao.email, idadeAtual, idadeAposent, rendaMensal, patrimonioAtual, rent, infl, aliqIR, patrimonioAlvo, pmtMensal:pmt, criadoEm:new Date().toISOString() });
  logEko('simulacao_salva', { tipo: 'aposentadoria' });
  const card = document.getElementById('ap-salvo-card');
  if(card){ card.style.display=''; setTimeout(()=>card.style.display='none', 4000); }
  toast('✅ Simulação salva!');
  await carregarHistoricoSimulacoes();
  } finally { liberarBotao(btn); }
};

window.salvarSimulacaoApProntuario = async function() {
  await salvarSimulacaoAp();
  await renderProntuario();
  toast('📋 Salvo no prontuário!');
};

window.salvarSimulacaoAc = async function() {
  const btn = btnDoClique(); if (btn) btn.disabled = true;
  try {
  const inicial = parseMoney(document.getElementById('ac-inicial').value) || 0;
  const aporte  = parseMoney(document.getElementById('ac-aporte').value) || 0;
  const anos    = parseInt(document.getElementById('ac-anos').value) || 0;
  const rent    = parseFloat(document.getElementById('ac-rent').value) || 1.0;
  const infl    = parseFloat(document.getElementById('ac-infl').value) || 0.4;
  const aliqIR  = parseFloat(document.getElementById('ac-ir').value)  || 15;
  const meses   = anos * 12;
  const r       = taxaReal(rent, infl);
  const bruto   = calcFV(inicial, aporte, r, meses);
  const investido = inicial + aporte * meses;
  const juros   = Math.max(0, bruto - investido);
  const liquido = bruto - juros*(aliqIR/100);
  await addDoc(collection(db,'simulacoes'), { tipo:'acumulacao', email:store.sessao.email, inicial, aporte, anos, rent, infl, aliqIR, patrimonioFinal:bruto, totalInvestido:investido, patrimonioLiquido:liquido, criadoEm:new Date().toISOString() });
  logEko('simulacao_salva', { tipo: 'acumulacao' });
  const card = document.getElementById('ac-salvo-card');
  if(card){ card.style.display=''; setTimeout(()=>card.style.display='none', 4000); }
  toast('✅ Simulação salva!');
  await carregarHistoricoSimulacoes();
  } finally { liberarBotao(btn); }
};

window.salvarSimulacaoAcProntuario = async function() {
  await salvarSimulacaoAc();
  await renderProntuario();
  toast('📋 Salvo no prontuário!');
};

async function getSimulacoes() {
  try {
    const q = query(collection(db,'simulacoes'), where('email','==',store.sessao.email));
    const snap = await getDocs(q); const r = [];
    snap.forEach(d => r.push({...d.data(), _id:d.id}));
    return r.sort((a,b) => (a.criadoEm||'') > (b.criadoEm||'') ? -1 : 1);
  } catch(e) { return []; }
}

async function carregarHistoricoSimulacoes() {
  const sims = await getSimulacoes();
  const wrap = document.getElementById('sim-historico');
  const lista = document.getElementById('sim-historico-lista');
  if (!sims.length) { wrap.style.display='none'; return; }
  wrap.style.display = '';
  lista.innerHTML = sims.slice(0,5).map(s => {
    const dt = new Date(s.criadoEm).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'});
    if (s.tipo === 'aposentadoria') {
      return `<div class="pront-item"><div class="pront-item-left"><div class="pront-item-icon">🏖️</div><div><div class="pront-item-title">Aposentadoria — ${fmt(s.rendaMensal)}/mês</div><div class="pront-item-sub">Guardar ${fmt(s.pmtMensal)}/mês · rent. ${s.rent}%/m · ${dt}</div></div></div></div>`;
    } else {
      return `<div class="pront-item"><div class="pront-item-left"><div class="pront-item-icon">💰</div><div><div class="pront-item-title">Acumulação — ${fmt(s.aporte)}/mês por ${s.anos}a</div><div class="pront-item-sub">Líquido: ${fmt(s.patrimonioLiquido||s.patrimonioFinal)} · ${dt}</div></div></div></div>`;
    }
  }).join('');
}

window.abrirSimulacoes = async function() {
  ir('screen-simulacoes');
  setupMoneyInputs();
  if (store.sessao && store.sessao.renda) {
    const el = document.getElementById('ap-renda');
    if (el && !el.value) {
      el.value = 'R$ ' + Number(store.sessao.renda).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
    }
  }
  await carregarHistoricoSimulacoes();
};

const calcularAposentadoriaDebounced = debounce(() => { try { calcularAposentadoria(); } catch(e){} }, 400);
const calcularAcumulacaoDebounced    = debounce(() => { try { calcularAcumulacao(); }    catch(e){} }, 400);

export { getSimulacoes };
