/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/hub.js
 * Tela inicial agregadora: resumo mensal, avisos, jornada de
 * 8 passos, revisão trimestral e composição dos sub-renders
 * de todas as features. É o módulo mais acoplado do sistema —
 * cada seção do renderHub roda em try/catch próprio para
 * limitar o raio de falha (padrão herdado do monólito).
 * Corpo movido verbatim; ordem original das faixas preservada.
 * ═══════════════════════════════════════════════════════════ */

import { db, collection, getDocs, query, where } from '../core/firebase.js';
import { store } from '../core/store.js';
import { fmt, diasAte } from '../utils/format.js';
import { toast } from '../utils/dom.js';
import { getDiags } from './diagnosticos.js';
import { getMetas } from './metas.js';
import { getDividas } from './dividas.js';
import { getSimulacoes } from './simulacoes.js';
import { getCFLancamentos, cfChaveMes, renderHubControle } from './controle.js';
import { atualizarHubReserva, getReservaConfig } from './reserva.js';

// ── HUB ──────────────────────────────────────────────
async function renderHub() {
  const diags = await getDiags(store.sessao.email);

  // metas summary in hub
  try {
    const metas = await getMetas();
    const ativas = metas.filter(m=>!m.concluida).length;
    const conc = metas.filter(m=>m.concluida).length;
    const sub = document.getElementById('hub-metas-sub');
    if(sub) {
      if(metas.length===0) sub.textContent='Nenhuma meta ainda';
      else {
        const txtAtivas = ativas===1 ? '1 ativa' : `${ativas} ativas`;
        const txtConc = conc===1 ? '1 concluída' : `${conc} concluídas`;
        sub.innerHTML=`${txtAtivas}${conc>0?' · <span style="color:var(--eko-green)">'+txtConc+' 🏆</span>':''}`;
      }
    }
  } catch(e){}

  // FASE 4 — Revisão trimestral (síncrono, reusa diags já buscado)
  try { renderRevisaoTrimestral(diags); } catch(e){ console.error('revisao',e); }

  // avisos (síncrono, reusa diags) — precisa rodar antes do Promise.all abaixo,
  // pois gerarAvisoControle() faz APPEND em #hub-avisos, então essa div já
  // precisa estar com o innerHTML inicial definido
  const avisos = gerarAvisos(diags);
  const avDiv = document.getElementById('hub-avisos');
  if (avisos.length) {
    avDiv.innerHTML = '<div class="section-title" style="margin-bottom:8px">🔔 Avisos</div>' +
      avisos.map(a => `<div class="aviso-item ${a.tipo}"><span>${a.icon}</span><div><div style="font-size:13px;font-weight:600">${a.titulo}</div><div style="font-size:12px;color:var(--text-muted)">${a.desc}</div></div></div>`).join('');
  } else avDiv.innerHTML = '';

  // Seções independentes — cada uma lê coleções diferentes e escreve em
  // elementos diferentes do DOM, então rodam em paralelo em vez de em série.
  // .catch() individual preserva o isolamento de falha que cada try/catch
  // tinha antes (uma seção falhando não derruba as outras); renderJornada
  // fica sem .catch() de propósito — já não tinha try/catch próprio e sua
  // rejeição deve propagar para o try/catch de carregarApp(), como antes.
  await Promise.all([
    renderResumoMensal().catch(e => console.error('resumo mensal', e)),
    renderHubControle().catch(e => {}),
    atualizarHubReserva().catch(e => {}),
    renderJornada(diags),
    gerarAvisoControle().catch(e => {}),
  ]);
}

function calcScore(diags) {
  if (!diags.length) return 0;
  const tipos = ['ciclo','independencia','casal'];
  let feitos = 0;
  tipos.forEach(t => { if (diags.find(d => d.tipo === t)) feitos++; });
  const diagScore = Math.round((feitos/3)*100*0.3);
  return Math.min(100, diagScore);
}

function gerarAvisos(diags) {
  const avisos = [];
  const tipos = [
    {tipo:'ciclo', nome:'Ciclo Financeiro', meses:3},
    {tipo:'independencia', nome:'Independência Financeira', meses:3},
    {tipo:'casal', nome:'Finanças a Dois', meses:6}
  ];
  tipos.forEach(({tipo, nome, meses}) => {
    const d = diags.find(x => x.tipo === tipo);
    if (d) {
      // Só mostra aviso se o diagnóstico JÁ foi feito e está próximo de liberar ou já liberado
      const prox = new Date(d.criadoEm);
      prox.setMonth(prox.getMonth() + meses);
      const dias = diasAte(prox.toISOString());
      if (dias <= 7 && dias > 0) {
        avisos.push({icon:'🔔', tipo:'warning', titulo:nome+' liberado em breve', desc:'Em '+dias+' dias você poderá refazer'});
      } else if (dias <= 0) {
        avisos.push({icon:'✅', tipo:'', titulo:nome+' disponível para refazer', desc:'Já se passaram '+meses+' meses desde o último teste'});
      }
    }
    // Diagnósticos pendentes NÃO aparecem nos avisos — ficam apenas na jornada
  });
  return avisos.slice(0,3);
}

async function gerarAvisoControle() {
  try {
    const lancs = await getCFLancamentos();
    const now = new Date();
    const chave = cfChaveMes(now.getFullYear(), now.getMonth());
    const doMes = lancs.filter(l=>l.chaveMes===chave);
    if(!doMes.length) {
      const avDiv = document.getElementById('hub-avisos');
      if(!avDiv) return;
      // Se ainda não tem cabeçalho de avisos, cria um
      if(!avDiv.querySelector('.section-title')) {
        const titulo = document.createElement('div');
        titulo.className = 'section-title';
        titulo.style.marginBottom = '8px';
        titulo.textContent = '🔔 Avisos';
        avDiv.prepend(titulo);
      }
      const alerta = document.createElement('div');
      alerta.className = 'aviso-item warning';
      alerta.innerHTML = '<span>💰</span><div><div style="font-size:13px;font-weight:600">Controle Financeiro vazio</div><div style="font-size:12px;color:var(--text-muted)">Você ainda não registrou nada este mês. Que tal começar agora? 🌱</div></div>';
      avDiv.appendChild(alerta);
    }
  } catch(e){}
}

async function renderJornada(diags){
  const ciclo=diags.find(d=>d.tipo==='ciclo');
  const indep=diags.find(d=>d.tipo==='independencia');
  let metas=[],dividas=[],sims=[],reserva=null,lancamentos=[];
  try{metas=await getMetas();}catch(e){}
  try{dividas=await getDividas();}catch(e){}
  try{sims=await getSimulacoes();}catch(e){}
  try{ reserva=await getReservaConfig(); }catch(e){}
  try{
    const q=query(collection(db,'controle'),where('email','==',store.sessao.email));
    const snap=await getDocs(q);
    lancamentos=snap.docs.map(d=>d.data());
  }catch(e){}

  const itens=[
    {num:'1',txt:'Fazer diagnóstico Ciclo Financeiro',done:!!ciclo,acao:"abrirDiagnosticos()"},
    {num:'2',txt:'Fazer diagnóstico Independência Financeira',done:!!indep,acao:"abrirDiagnosticos()"},
    {num:'3',txt:'Organizar suas dívidas',done:dividas.length>0,acao:"abrirDividas()"},
    {num:'4',txt:'Configurar sua reserva de emergência',done:!!reserva,acao:"abrirReserva()"},
    {num:'5',txt:'Criar primeira meta financeira',done:metas.length>0,acao:"abrirMetas()"},
    {num:'6',txt:'Fazer simulação de aposentadoria',done:sims.some(s=>s.tipo==='aposentadoria'),acao:"abrirSimulacoes()"},
    {num:'7',txt:'Registrar primeiro lançamento no Controle',done:lancamentos.length>0,acao:"abrirControleFinanceiro()"},
  ];
  const proximo=itens.find(i=>!i.done);
  if(!proximo){
    document.getElementById('hub-jornada').innerHTML=`<div class="jornada-item" style="background:var(--eko-green-light);border-color:var(--eko-green)"><div style="font-size:20px">🎉</div><div style="font-size:13px;font-weight:700;color:var(--eko-green-dark);flex:1">Jornada completa! Parabéns!</div></div>`;
    return;
  }
  const concluidos=itens.filter(i=>i.done).length;
  document.getElementById('hub-jornada').innerHTML=`
    <div class="section-title" style="margin-bottom:8px">📍 Próximo passo <span style="font-size:11px;color:var(--text-muted);font-weight:500">${concluidos}/${itens.length}</span></div>
    <div class="jornada-item" onclick="${proximo.acao}" style="cursor:pointer">
      <div class="jornada-num">${proximo.num}</div>
      <div style="font-size:13px;font-weight:600;flex:1">${proximo.txt}</div>
      <div style="font-size:16px;color:var(--eko-green)">→</div>
    </div>`;
}

// ════════════════════════════════════════════════
// FASE 4 — RESUMO MENSAL AUTOMÁTICO
// ════════════════════════════════════════════════

async function renderResumoMensal() {
  const el = document.getElementById('hub-resumo-mensal');
  if (!el) return;

  const agora = new Date();
  const mesAtualStr = agora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const anoMes = `${agora.getFullYear()}-${String(agora.getMonth()+1).padStart(2,'0')}`;

  let metas = [], dividas = [];
  try { metas = await getMetas(); } catch(e){}
  try { dividas = await getDividas(); } catch(e){}

  // Quanto guardou nas metas este mês
  let guardadoMes = 0;
  let metasEmDia = 0;
  let metasTotal = 0;
  metas.filter(m => !m.concluida).forEach(meta => {
    metasTotal++;
    const inicio = new Date(meta.inicio + '-01');
    const mesIdx = Math.floor((agora - inicio) / (1000*60*60*24*30.44));
    const dep = meta.depositos?.[mesIdx];
    if (dep && dep.pago) {
      guardadoMes += dep.valor || 0;
      metasEmDia++;
    }
  });

  // Dívidas pagas este mês
  let dividasPagas = 0;
  dividas.forEach(div => {
    if (div.historicoPagamentos) {
      const pagoEsseMes = div.historicoPagamentos.filter(p => {
        const d = new Date(p.data);
        return d.getFullYear() === agora.getFullYear() && d.getMonth() === agora.getMonth() && p.tipo !== 'nao_pago';
      });
      if (pagoEsseMes.length > 0) dividasPagas++;
    }
  });

  if (metas.length === 0 && dividas.length === 0) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="resumo-mensal">
      <div class="resumo-mensal-titulo">📅 Resumo de ${mesAtualStr}</div>
      <div class="resumo-grid">
        <div class="resumo-item">
          <div class="resumo-item-val" style="color:var(--eko-green)">${fmt(guardadoMes)}</div>
          <div class="resumo-item-label">Guardado</div>
        </div>
        <div class="resumo-item">
          <div class="resumo-item-val" style="color:${metasEmDia===metasTotal&&metasTotal>0?'var(--eko-green)':'var(--amber)'}">${metasEmDia}/${metasTotal}</div>
          <div class="resumo-item-label">Metas em dia</div>
        </div>
        <div class="resumo-item">
          <div class="resumo-item-val" style="color:${dividasPagas>0?'var(--eko-green)':'var(--text-muted)'}">${dividasPagas}</div>
          <div class="resumo-item-label">Dívidas pagas</div>
        </div>
      </div>
      ${metasEmDia === metasTotal && metasTotal > 0 ? '<div style="margin-top:.625rem;font-size:12px;font-weight:600;color:var(--eko-green);text-align:center">🏆 Mês perfeito! Todas as metas em dia.</div>' : ''}
    </div>`;
}

// ════════════════════════════════════════════════
// FASE 4 — REVISÃO TRIMESTRAL
// ════════════════════════════════════════════════

function renderRevisaoTrimestral(diags) {
  const el = document.getElementById('hub-revisao');
  if (!el) return;

  // Verifica se tem algum diagnóstico feito há mais de 3 meses
  const agora = new Date();
  const TRES_MESES_MS = 90 * 24 * 60 * 60 * 1000;

  // Verifica última revisão registrada localmente
  const ultimaRevisaoKey = 'eko_revisao_' + store.sessao.email;
  const ultimaRevisao = localStorage.getItem(ultimaRevisaoKey);

  let mostrar = false;
  let motivo = '';

  // Verifica se algum diagnóstico está disponível para refazer
  const tipos = [
    {tipo:'ciclo', nome:'Ciclo Financeiro', meses:3},
    {tipo:'independencia', nome:'Independência Financeira', meses:3},
    {tipo:'casal', nome:'Finanças a Dois', meses:6}
  ];

  let diagsDisponiveis = 0;
  tipos.forEach(({tipo, meses}) => {
    const d = diags.find(x => x.tipo === tipo);
    if (d) {
      const prox = new Date(d.criadoEm);
      prox.setMonth(prox.getMonth() + meses);
      if (new Date() >= prox) diagsDisponiveis++;
    }
  });

  // Mostra aviso se passou 3 meses desde última revisão reconhecida
  if (ultimaRevisao) {
    const diff = agora - new Date(ultimaRevisao);
    if (diff >= TRES_MESES_MS) { mostrar = true; motivo = 'Já faz 3 meses desde sua última revisão financeira.'; }
  } else if (diags.length > 0) {
    // Tem diagnósticos mas nunca fez revisão formal
    const maisAntigo = diags.reduce((oldest, d) => !oldest || d.criadoEm < oldest.criadoEm ? d : oldest, null);
    if (maisAntigo && (agora - new Date(maisAntigo.criadoEm)) >= TRES_MESES_MS) {
      mostrar = true; motivo = 'É hora de revisar sua situação financeira — faz mais de 3 meses!';
    }
  }

  if (!mostrar && diagsDisponiveis === 0) { el.innerHTML = ''; return; }
  if (!mostrar && diagsDisponiveis > 0) {
    mostrar = true;
    motivo = `${diagsDisponiveis} diagnóstico(s) disponível(is) para refazer.`;
  }

  el.innerHTML = `
    <div class="revisao-card" onclick="iniciarRevisaoTrimestral()">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:11px;font-weight:800;color:var(--amber);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">🔄 Revisão trimestral</div>
          <div style="font-size:14px;font-weight:700;color:#7A4010">${motivo}</div>
          <div style="font-size:12px;color:#8B5E10;margin-top:2px">Toque para iniciar sua revisão →</div>
        </div>
        <div style="font-size:28px">📊</div>
      </div>
    </div>`;
}

window.iniciarRevisaoTrimestral = function() {
  // Registra que o usuário iniciou revisão hoje
  localStorage.setItem('eko_revisao_' + store.sessao.email, new Date().toISOString());
  // Leva para diagnósticos
  abrirDiagnosticos();
  toast('🔄 Iniciando revisão trimestral...');
};

export { renderHub, gerarAvisos };
