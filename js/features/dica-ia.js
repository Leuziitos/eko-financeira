/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/dica-ia.js
 * Dica financeira do dia via IA (Netlify Function /dica →
 * Anthropic). Cache diário por usuário em localStorage.
 *
 * NOTA: getMetas/getDividas/getObjetivos são resolvidas via
 * ponte window.* enquanto metas/dividas/objetivos ainda vivem
 * no inline — viram imports quando esses módulos forem
 * extraídos (Fase 4). Corpo movido verbatim.
 * ═══════════════════════════════════════════════════════════ */

import { store } from '../core/store.js';

// ════════════════════════════════════════════════
// FASE 4 — DICA FINANCEIRA IA (Claude API)
// ════════════════════════════════════════════════

let _dicaCache = null;
let _dicaCacheData = null;

async function renderDicaIA() {
  const el = document.getElementById('hub-dica');
  if (!el) return;

  // Cache por dia em localStorage (persiste entre abas e recarregamentos)
  const hoje = new Date().toISOString().slice(0,10); // YYYY-MM-DD
  const cacheKey = 'eko_dica_' + store.sessao.email + '_' + hoje;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    el.innerHTML = renderDicaHtml(cached);
    return;
  }

  // Mostra loading
  el.innerHTML = `<div class="dica-card"><div class="dica-card-label">💡 Dica do dia</div><div class="dica-loading"><span class="spinner"></span> Gerando sua dica personalizada...</div></div>`;

  try {
    // Coleta contexto do usuário
    let metas = [], dividas = [], objetivos = [];
    try { metas = await getMetas(); } catch(e){}
    try { dividas = await getDividas(); } catch(e){}
    try { objetivos = await getObjetivos(); } catch(e){}

    const renda = store.sessao.renda || 0;
    const totalDividas = dividas.reduce((s,d) => s + (d.parcela*(d.parcelasRestantes||0)), 0);
    const totalMetas = metas.filter(m=>!m.concluida).length;
    const metasConc = metas.filter(m=>m.concluida).length;
    const dividasAtraso = dividas.filter(d=>d.emAtraso).length;

    const contexto = [
      renda > 0 ? `Renda mensal: R$ ${renda.toLocaleString('pt-BR')}` : null,
      totalMetas > 0 ? `${totalMetas} meta(s) financeira(s) ativa(s)` : null,
      metasConc > 0 ? `${metasConc} meta(s) já concluída(s)` : null,
      dividas.length > 0 ? `${dividas.length} dívida(s) ativa(s), total R$ ${totalDividas.toLocaleString('pt-BR', {maximumFractionDigits:0})}` : null,
      dividasAtraso > 0 ? `${dividasAtraso} dívida(s) em atraso` : null,
      objetivos.length > 0 ? `${objetivos.length} objetivo(s) de longo prazo` : null,
    ].filter(Boolean).join('; ');

    const prompt = `Você é um assistente de educação financeira do app Eko Financeira, desenvolvido por Leonardo Braulino (Projeto PEF).

Contexto do usuário: ${contexto || 'usuário iniciando no app'}.

Gere UMA dica financeira prática, motivadora e personalizada para este usuário. 
Regras:
- Máximo 2 frases curtas e diretas
- Tom encorajador e acessível, sem jargões
- Baseada no contexto do usuário quando disponível
- Sem emojis excessivos — apenas 1 no início
- Não cite valores exatos do usuário, use referências gerais
- Responda APENAS com o texto da dica, sem título nem introdução`;

    const response = await fetch('/.netlify/functions/dica', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contexto, prompt })
    });

    const data = await response.json();
    const dica = data?.dica?.trim() || '';

    if (dica) {
      localStorage.setItem(cacheKey, dica);
      el.innerHTML = renderDicaHtml(dica);
    } else {
      el.innerHTML = '';
    }
  } catch(e) {
    console.error('dica ia', e);
    el.innerHTML = ''; // falha silenciosa
  }
}

function renderDicaHtml(texto) {
  return `<div class="dica-card">
    <div class="dica-card-label">💡 Dica do dia</div>
    <div class="dica-card-texto">${texto}</div>
    <div style="margin-top:.5rem;font-size:10px;color:var(--eko-green-dark);font-weight:600;opacity:.7">Por Leonardo Braulino · PEF</div>
  </div>`;
}

export { renderDicaIA };
