/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/prontuario.js
 * Prontuário Financeiro: histórico agregado de diagnósticos,
 * reserva, metas, dívidas, simulações, objetivos e aulas, com
 * detalhe de diagnóstico (DESCS_CICLO + abrirDiagDetalhe).
 * Ciclos de import com metas/auth/hub são seguros: só há
 * declarações no top-level, chamadas ocorrem em runtime.
 * Corpo movido verbatim; ordem original das faixas preservada.
 * ═══════════════════════════════════════════════════════════ */

import { db, doc, getDoc } from '../core/firebase.js';
import { store } from '../core/store.js';
import { ir } from '../core/router.js';
import { fmt, esc, diasAte } from '../utils/format.js';
import { getUser } from './auth.js';
import { getDiags, DIAGS_CONFIG } from './diagnosticos.js';
import { getMetas, calcAcumulado, statusMeta } from './metas.js';
import { getDividas } from './dividas.js';
import { getObjetivos } from './objetivos.js';
import { getSimulacoes } from './simulacoes.js';
import { getAulasConcluidas } from './aulas.js';
import { gerarAvisos } from './hub.js';

// ── PRONTUÁRIO ──────────────────────────────────────────────
async function renderProntuario() {
  const user = await getUser(store.sessao.email);
  if (!user) return;
  document.getElementById('pront-nome').textContent = user.nome;
  const desde = new Date(user.criadoEm).toLocaleDateString('pt-BR', {month:'long', year:'numeric'});
  document.getElementById('pront-membro').textContent = 'Membro desde ' + desde;
  const diags = await getDiags(store.sessao.email);

  // diags — clickable
  const tipos = [
    {tipo:'ciclo', el:'pront-diag-ciclo', nome:'Ciclo Financeiro', meses:3, icon:'🔄'},
    {tipo:'independencia', el:'pront-diag-if', nome:'Independência Financeira', meses:3, icon:'💰'},
    {tipo:'casal', el:'pront-diag-casal', nome:'Finanças a Dois', meses:6, icon:'👫'}
  ];
  tipos.forEach(({tipo, el, nome, meses, icon}) => {
    const d = diags.find(x => x.tipo === tipo);
    const elDiv = document.getElementById(el);
    elDiv.style.cursor = 'pointer';
    elDiv.onclick = () => abrirDiagDetalhe(tipo);
    if (d) {
      const data = new Date(d.criadoEm).toLocaleDateString('pt-BR', {day:'2-digit', month:'short'});
      const prox = new Date(d.criadoEm); prox.setMonth(prox.getMonth() + meses);
      const dias = diasAte(prox.toISOString());
      const sub = data + ' · ' + (dias > 0 ? 'Próximo em '+dias+'d' : 'Disponível para refazer');
      const res = d.resultado||'';
      const badgeClass = (res.includes('Expansão')||res.includes('Referência')||res.includes('Saudável')||res.includes('Acima')) ? 'badge-green' : (res.includes('Equilíbrio')||res.includes('Construção')||res.includes('Comum')) ? 'badge-amber' : 'badge-red';
      elDiv.innerHTML = `<div class="pront-item-left"><div class="pront-item-icon">${icon}</div><div><div class="pront-item-title">${esc(nome)}</div><div class="pront-item-sub">${esc(sub)}</div></div></div><div style="display:flex;align-items:center;gap:6px"><span class="badge ${badgeClass}">${d.resultado||'Feito'}</span><span style="color:var(--eko-green);font-size:14px">→</span></div>`;
    } else {
      elDiv.innerHTML = `<div class="pront-item-left"><div class="pront-item-icon">${icon}</div><div><div class="pront-item-title">${esc(nome)}</div><div class="pront-item-sub">Não realizado — toque para iniciar</div></div></div><span style="color:var(--eko-green);font-size:14px">→</span>`;
    }
  });

  // Reserva de Emergência no prontuário
  try {
    const snapRes = await getDoc(doc(db, 'reserva', store.sessao.email));
    const elRes = document.getElementById('pront-reserva-resumo');
    if (elRes) {
      if (snapRes.exists()) {
        const r = snapRes.data();
        const pct = Math.min(100, Math.round(((r.saldoAtual||0) / r.meta) * 100));
        const completa = pct >= 100;
        elRes.className = 'pront-item';
        elRes.innerHTML = `<div class="pront-item-left"><div class="pront-item-icon">🛡️</div><div>
          <div class="pront-item-title">${completa ? 'Reserva completa! 🎉' : pct + '% da meta'}</div>
          <div class="pront-item-sub">${fmt(r.saldoAtual||0)} de ${fmt(r.meta)} · ${r.mesesCobertura} meses</div>
        </div></div><span class="badge ${completa ? 'badge-green' : pct >= 50 ? 'badge-amber' : 'badge-red'}">${pct}%</span>`;
      } else {
        elRes.className = 'pront-empty';
        elRes.innerHTML = 'Reserva não configurada';
      }
    }
  } catch(e) {}

  // fase 2 data
  try {
    const metas = await getMetas();
    const dividas = await getDividas();
    const objetivos = await getObjetivos();
    const totalAcum = metas.reduce((s,m)=>s+calcAcumulado(m),0);
    const metasAtivas = metas.filter(m=>statusMeta(m)!=='concluida').length;
    const metasConc = metas.filter(m=>statusMeta(m)==='concluida').length;
    const metasConcluidas=metas.filter(m=>m.concluida);
    const metasAtivas2=metas.filter(m=>!m.concluida);
    document.getElementById('pront-metas-resumo').className = metas.length ? '' : 'pront-empty';
    if(metas.length){
      let html=`<div class="pront-item"><div class="pront-item-left"><div class="pront-item-icon">🎯</div><div><div class="pront-item-title">${metasAtivas2.length} meta(s) ativa(s)</div><div class="pront-item-sub">Acumulado: ${fmt(totalAcum)}</div></div></div><span class="badge badge-green">${metas.length} total</span></div>`;
      if(metasConcluidas.length){
        html+=`<div style="margin-top:8px"><div class="section-title">🏆 Metas concluídas</div>`;
        html+=metasConcluidas.map(m=>`<div class="pront-item" style="margin-bottom:6px;opacity:.8"><div class="pront-item-left"><div class="pront-item-icon">${m.catIcon||'🎯'}</div><div><div class="pront-item-title">${esc(m.nome)}</div><div class="pront-item-sub">Concluída em ${new Date(m.concluidaEm).toLocaleDateString('pt-BR',{month:'long',year:'numeric'})} · ${fmt(calcAcumulado(m))}</div></div></div><span class="badge badge-green">✅</span></div>`).join('');
        html+=`</div>`;
      }
      document.getElementById('pront-metas-resumo').innerHTML=html;
    } else {
      document.getElementById('pront-metas-resumo').innerHTML='Nenhuma meta ainda';
    }
    const totalDividas = dividas.reduce((s,d)=>s+(d.parcela*(d.parcelasRestantes||0)),0);
    document.getElementById('pront-dividas-resumo').className = dividas.length ? 'pront-item' : 'pront-empty';
    document.getElementById('pront-dividas-resumo').innerHTML = dividas.length ?
      `<div class="pront-item-left"><div class="pront-item-icon">💳</div><div><div class="pront-item-title">${dividas.length} dívida(s) ativa(s)</div><div class="pront-item-sub">Total: ${fmt(totalDividas)}</div></div></div><span class="badge badge-red">${dividas.filter(d=>d.emAtraso).length} em atraso</span>` :
      'Nenhuma dívida cadastrada';
    const totalObjetivos = objetivos.reduce((s,o)=>s+(o.pmt||0),0);
    const renda = store.sessao.renda||0;
    const pctRenda = renda>0?Math.round((totalObjetivos/renda)*100):0;
    document.getElementById('pront-objetivos-resumo').className = objetivos.length ? 'pront-item' : 'pront-empty';
    document.getElementById('pront-objetivos-resumo').innerHTML = objetivos.length ?
      `<div class="pront-item-left"><div class="pront-item-icon">🏆</div><div>
        <div class="pront-item-title">${objetivos.length} objetivo(s)</div>
        <div class="pront-item-sub">Total mensal: <strong>${fmt(totalObjetivos)}</strong>${renda>0?' · '+pctRenda+'% da renda':''}</div>
      </div></div><span class="badge ${pctRenda>30?'badge-red':pctRenda>0?'badge-amber':'badge-gray'}">${pctRenda>0?pctRenda+'%':'--'}</span>` :
      'Nenhum objetivo ainda';
  } catch(e) { console.error('fase2 prontuario', e); }

  // Fase 3: simulações no prontuário
  try {
    const sims = await getSimulacoes();
    const elSim = document.getElementById('pront-simulacoes-resumo');
    if (sims.length) {
      elSim.className = 'pront-item';
      const ultima = sims[0];
      const tipoLabel = ultima.tipo === 'aposentadoria' ? '🏖️ Aposentadoria' : '💰 Acumulação';
      const detalhe = ultima.tipo === 'aposentadoria'
        ? `Renda: ${fmt(ultima.rendaMensal)}/mês · Guardar: ${fmt(ultima.pmtMensal)}/mês`
        : `Aporte: ${fmt(ultima.aporte)}/mês · Total: ${fmt(ultima.patrimonioFinal)}`;
      elSim.innerHTML = `<div class="pront-item-left"><div class="pront-item-icon">📈</div><div><div class="pront-item-title">${sims.length} simulação(ões) salva(s)</div><div class="pront-item-sub">${tipoLabel} · ${detalhe}</div></div></div><span class="badge badge-blue">${sims.length}x</span>`;
    } else {
      elSim.className = 'pront-empty';
      elSim.innerHTML = 'Nenhuma simulação realizada';
    }
  } catch(e) {}

  // Fase 3: aulas no prontuário
  try {
    const concluidas = await getAulasConcluidas();
    const totalAulas = Object.keys(concluidas).length;
    const elAulas = document.getElementById('pront-aulas-resumo');
    if (elAulas) {
      if (totalAulas > 0) {
        elAulas.className = 'pront-item';
        const pct = Math.round((totalAulas/12)*100);
        elAulas.innerHTML = `<div class="pront-item-left"><div class="pront-item-icon">🎬</div><div><div class="pront-item-title">${totalAulas} de 12 aulas concluídas</div><div class="pront-item-sub">${pct}% do programa PEF</div></div></div><span class="badge ${totalAulas===12?'badge-green':'badge-amber'}">${pct}%</span>`;
      } else {
        elAulas.className = 'pront-empty';
        elAulas.innerHTML = 'Nenhuma aula concluída ainda';
      }
    }
  } catch(e) {}

  // conquistas
  // avisos
  const avisos = gerarAvisos(diags);
  const avDiv = document.getElementById('pront-avisos');
  avDiv.innerHTML = avisos.length ? avisos.map(a => `<div class="aviso-item ${a.tipo}"><span>${a.icon}</span><div><div style="font-size:13px;font-weight:600">${a.titulo}</div><div style="font-size:12px;color:var(--text-muted)">${a.desc}</div></div></div>`).join('') : '<div class="pront-empty">Nenhum aviso no momento ✅</div>';
}

async function calcConquistas(diags) {
  const ciclo = diags.find(d => d.tipo === 'ciclo');
  const indep = diags.find(d => d.tipo === 'independencia');
  const casal = diags.find(d => d.tipo === 'casal');
  const metas = await getMetas();
  const metasConc = metas.filter(m=>m.concluida);
  return [
    {icon:'🔍', title:'Primeiro diagnóstico', desc:'Realize seu primeiro diagnóstico financeiro', desbloqueada:!!(ciclo||indep||casal)},
    {icon:'📊', title:'Triagem completa', desc:'Complete os 3 diagnósticos financeiros', desbloqueada:!!(ciclo&&indep&&casal)},
    {icon:'🌱', title:'Ciclo de Expansão', desc:'Alcance o Ciclo de Expansão no diagnóstico', desbloqueada:!!(ciclo&&ciclo.resultado==='Ciclo de Expansão')},
    {icon:'⭐', title:'Referência', desc:'Alcance o nível Referência em Independência Financeira', desbloqueada:!!(indep&&indep.resultado==='Referência')},
    {icon:'🎯', title:'Primeira meta criada', desc:'Crie sua primeira meta financeira', desbloqueada:metas.length>0},
    {icon:'🏆', title:'Meta concluída', desc:'Conclua sua primeira meta financeira', desbloqueada:metasConc.length>0},
    {icon:'💪', title:'5 metas concluídas', desc:'Conclua 5 metas financeiras', desbloqueada:metasConc.length>=5},
  ];
}

// ── Diagnóstico Detalhe (prontuário) ─────────────────────
const DESCS_CICLO = {
  'Ciclo de Expansão':{cor:'expansao',desc:'Você está construindo sua vida com clareza e consistência. Continue evoluindo — os resultados aparecem para quem mantém o foco.',icon:'🟢'},
  'Ciclo de Equilíbrio':{cor:'equilibrio',desc:'Você está estável, mas ainda há espaço para crescer. O risco aqui é a acomodação — pequenas ações consistentes podem mudar seu patamar.',icon:'🟡'},
  'Ciclo de Atenção':{cor:'atencao',desc:'Alguns aspectos da sua vida pedem uma revisão urgente. Reorganizar suas prioridades agora pode evitar perdas maiores no futuro.',icon:'🔴'},
  'Referência':{cor:'expansao',desc:'Você está no caminho certo e provavelmente já percebeu que pensa diferente das pessoas ao seu redor. Continue — os resultados vêm para quem age com consistência.',icon:'⭐'},
  'Acima da Média':{cor:'expansao',desc:'Você está mais preparado do que a maioria. Ainda existem lacunas que podem gerar imprevistos — vale reforçar os pontos mais fracos.',icon:'🟢'},
  'Caminho Comum':{cor:'equilibrio',desc:'Você segue o padrão da maioria das pessoas. É um começo, mas provavelmente insuficiente para garantir tranquilidade no futuro.',icon:'🟡'},
  'Ponto de Partida':{cor:'atencao',desc:'Sua independência financeira ainda está distante. O primeiro passo é reconhecer isso — e começar a agir com pequenas mudanças consistentes.',icon:'🔴'},
  'Relação Saudável':{cor:'expansao',desc:'Vocês mantêm uma relação financeira madura e aberta. Continuem evoluindo — sempre há algo a melhorar.',icon:'🟢'},
  'Em Construção':{cor:'equilibrio',desc:'Vocês têm abertura para falar sobre finanças, mas alguns pontos críticos ainda ficam de fora. Revejam juntos onde perderam pontos.',icon:'🟡'},
  'Diálogo Iniciante':{cor:'atencao',desc:'O tema dinheiro ainda é pouco explorado entre vocês. Pequenas conversas regulares podem transformar completamente a relação financeira do casal.',icon:'🔴'},
};

window.abrirDiagDetalhe = async function(tipo) {
  const diags = await getDiags(store.sessao.email);
  const cfg = DIAGS_CONFIG.find(d => d.tipo === tipo);
  const hist = diags.filter(d => d.tipo === tipo).sort((a,b) => b.criadoEm > a.criadoEm ? 1 : -1);
  const ultimo = hist[0];

  document.getElementById('diag-det-header').innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Diagnóstico</div>
    <div style="font-size:22px;font-weight:800">${cfg.icon} ${cfg.nome}</div>`;

  if(ultimo) {
    const info = DESCS_CICLO[ultimo.resultado] || {};
    const data = new Date(ultimo.criadoEm).toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'});
    const prox = new Date(ultimo.criadoEm); prox.setMonth(prox.getMonth()+cfg.meses);
    const dias = diasAte(prox.toISOString());

    document.getElementById('diag-det-resultado').innerHTML = `
      <div class="resultado-ciclo ${info.cor||'equilibrio'}" style="margin-bottom:1.25rem">
        <div style="font-size:36px;margin-bottom:.5rem">${info.icon||'📊'}</div>
        <div style="font-size:20px;font-weight:800;margin-bottom:.25rem">${ultimo.resultado}</div>
        <div style="font-size:13px;opacity:.8;margin-bottom:.75rem">${(ultimo.pontos>0?'+':'')+ultimo.pontos} pontos · ${data}</div>
        <div style="font-size:14px;line-height:1.7">${info.desc||''}</div>
      </div>
      <div style="font-size:13px;color:var(--text-muted);text-align:center;margin-bottom:1.25rem">
        ${dias>0?`🔒 Próximo diagnóstico em <strong>${dias} dias</strong>`:'✅ Disponível para refazer'}
      </div>`;

    if(hist.length > 1) {
      document.getElementById('diag-det-historico').innerHTML = `
        <div class="section-title">Histórico</div>
        ${hist.map((h,i) => {
          const badgeClass = (h.resultado?.includes('Expansão')||h.resultado?.includes('Referência')||h.resultado?.includes('Saudável')||h.resultado?.includes('Acima')) ? 'badge-green' : (h.resultado?.includes('Equilíbrio')||h.resultado?.includes('Construção')||h.resultado?.includes('Comum')) ? 'badge-amber' : 'badge-red';
          const dt = new Date(h.criadoEm).toLocaleDateString('pt-BR',{month:'short',year:'numeric'});
          const evolucao = i < hist.length-1 ? (h.pontos - hist[i+1].pontos) : null;
          return `<div class="pront-item" style="margin-bottom:6px">
            <div class="pront-item-left">
              <div style="width:36px;height:36px;border-radius:50%;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;flex-shrink:0">${i===0?'🏆':i+1+'º'}</div>
              <div>
                <div style="font-size:13px;font-weight:600">${esc(h.resultado)}</div>
                <div style="font-size:11px;color:var(--text-muted)">${dt} · ${h.pontos>0?'+':''}${h.pontos} pts${evolucao!==null?' · '+(evolucao>0?'▲ +'+evolucao:evolucao<0?'▼ '+evolucao:'→ igual'):''}
                </div>
              </div>
            </div>
            <span class="badge ${badgeClass}">${h.pontos>0?'+':''}${h.pontos}</span>
          </div>`;
        }).join('')}`;
    } else {
      document.getElementById('diag-det-historico').innerHTML = '';
    }

    document.getElementById('diag-det-btn').innerHTML = dias <= 0 ?
      `<button class="btn btn-primary" onclick="iniciarQuiz('${tipo}');ir('screen-quiz')">Refazer diagnóstico</button>` :
      `<button class="btn btn-primary" onclick="ir('screen-diagnosticos')">Ver todos os diagnósticos</button>`;
  } else {
    document.getElementById('diag-det-resultado').innerHTML = '<div class="empty-state">Diagnóstico ainda não realizado.</div>';
    document.getElementById('diag-det-historico').innerHTML = '';
    document.getElementById('diag-det-btn').innerHTML = `<button class="btn btn-primary" onclick="iniciarQuiz('${tipo}');ir('screen-quiz')">Iniciar diagnóstico</button>`;
  }
  ir('screen-diag-detalhe');
};

export { renderProntuario };
