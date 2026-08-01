/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/objetivos.js
 * Objetivos Financeiros de longo prazo: CRUD (coleção
 * 'objetivos'), cálculo de PMT, balde mensal e geração de
 * meta vinculada (origemObjetivoId — o saldo é sincronizado
 * de volta pelo runTransaction em metas.js/saveMeta2).
 * renderProntuario via ponte window.* até a Fase 5.
 * Corpo movido verbatim; ordem original das faixas preservada.
 * ═══════════════════════════════════════════════════════════ */

import { db, doc, setDoc, deleteDoc, collection, getDocs, addDoc, query, where } from '../core/firebase.js';
import { store } from '../core/store.js';
import { ir } from '../core/router.js';
import { fmt, esc } from '../utils/format.js';
import { parseMoney } from '../utils/money.js';
import { calcPMT } from '../utils/finance-math.js';
import { showMsg, limparMsg, toast, abrirOverlay, fecharOverlay, btnDoClique, liberarBotao } from '../utils/dom.js';
import { saveMeta2, renderMetas } from './metas.js';
import { renderProntuario } from './prontuario.js';

// ── Editar Objetivo ──────────────────────────────────────
window.editarObjetivo = async function(id) {
  const objs = await getObjetivos();
  const obj = objs.find(o => o._id === id);
  if(!obj) return;
  document.getElementById('sheet-obj-title').textContent = '✏️ Editar objetivo';
  document.getElementById('obj-nome').value = obj.nome;
  document.getElementById('obj-valor').value = obj.valor;
  document.getElementById('obj-saldo').value = obj.saldo || 0;
  document.getElementById('obj-meses').value = obj.meses;
  document.getElementById('obj-rent').value = obj.rent || 1;
  document.getElementById('obj-obs').value = obj.obs || '';
  document.getElementById('obj-preview').style.display = 'none';
  limparMsg('sheet-obj-msg');
  // Store editing id
  window._editandoObjetivoId = id;
  abrirOverlay('overlay-objetivo');
};

// ── Excluir Objetivo ─────────────────────────────────────
window.excluirObjetivo = async function(id) {
  if(!confirm('Excluir este objetivo? Esta ação não pode ser desfeita.')) return;
  try {
    await deleteDoc(doc(db, 'objetivos', id));
  } catch(e) {
    const objs = await getObjetivos();
    const obj = objs.find(o => o._id === id);
    if(obj) { obj.excluida = true; await saveObjetivo(obj); }
  }
  await renderObjetivos();
  toast('🗑️ Objetivo excluído.');
  await renderProntuario();
};

// ── Gerar Meta a partir de Objetivo ──────────────────────
window.gerarMetaDeObjetivo = async function(id) {
  const objs = await getObjetivos();
  const obj = objs.find(o => o._id === id);
  if(!obj) return;
  if(!confirm(`Criar meta financeira "${esc(obj.nome)}" com ${fmt(obj.pmt||0)}/mês?`)) return;
  const meses = obj.meses || 12;
  const deps = Array(meses).fill(null).map(() => ({pago:false, parcial:false, extra:false, valor:0}));
  const nova = {
    nome: obj.nome,
    meta: obj.valor,
    meses,
    dia: 10,
    inicio: new Date().toISOString().slice(0,7),
    mensal: obj.pmt || 0,
    catIcon: '🏆',
    catNome: 'Objetivo',
    saldoExtra: 0,
    depositos: deps,
    email: store.sessao.email,
    origemObjetivoId: id
  };
  await saveMeta2(nova);
  toast('🎯 Meta criada a partir do objetivo!');
  await renderMetas();
  ir('screen-metas');
};

// ════════════════════════════════════════════════
// FASE 2 — OBJETIVOS FINANCEIROS
// ════════════════════════════════════════════════
async function getObjetivos(){try{const q=query(collection(db,'objetivos'),where('email','==',store.sessao.email));const snap=await getDocs(q);const r=[];snap.forEach(d=>r.push({...d.data(),_id:d.id}));return r.filter(o=>!o.excluida).sort((a,b)=>(a.ordem||99)-(b.ordem||99));}catch(e){return[];}}
async function saveObjetivo(obj){const{_id,...data}=obj;if(_id){await setDoc(doc(db,'objetivos',_id),data);}else{data.email=store.sessao.email;data.criadoEm=new Date().toISOString();const ref=await addDoc(collection(db,'objetivos'),data);obj._id=ref.id;}}

window.calcularObjetivo=function(){
  const val=parseMoney(document.getElementById('obj-valor').value)||0;const saldo=parseMoney(document.getElementById('obj-saldo').value)||0;const meses=parseInt(document.getElementById('obj-meses').value)||0;const rent=(parseFloat(document.getElementById('obj-rent').value)||1)/100;const prev=document.getElementById('obj-preview');
  if(!val||!meses){prev.style.display='none';return;}
  const pmt=Math.max(0,calcPMT(saldo,val,rent,meses));const prazoAnos=Math.floor(meses/12);const prazoMeses=meses%12;const prazoStr=(prazoAnos>0?prazoAnos+'a ':'')+prazoMeses+'m';const dt=new Date();dt.setMonth(dt.getMonth()+meses);const conclusao=dt.toLocaleDateString('pt-BR',{month:'short',year:'numeric'});
  const renda=store.sessao.renda||0;const viavel=renda>0?(pmt<=renda*0.3?'✅ Viável — dentro do recomendado':pmt<=renda*0.5?'⚠️ Desafiador — exigirá disciplina':'🔴 Difícil — considere aumentar o prazo'):'';
  prev.style.display='block';prev.innerHTML=`<div style="font-size:14px;font-weight:700;color:var(--eko-green);margin-bottom:.5rem">💰 Valor mensal necessário: ${fmt(pmt)}</div><div style="font-size:12px;color:var(--text-muted);line-height:1.8">⏱️ Prazo: ${prazoStr} → conclusão em ${conclusao}${viavel?'<br>'+viavel:''}</div>`;
};

async function renderObjetivos(){
  const objs=await getObjetivos();const renda=store.sessao.renda||0;const totalMensal=objs.reduce((s,o)=>s+(o.pmt||0),0);const pctRenda=renda>0?Math.round((totalMensal/renda)*100):0;
  const balde=document.getElementById('objetivos-balde');
  if(objs.length){balde.innerHTML=`<div class="obj-balde"><div style="font-size:13px;font-weight:700;margin-bottom:.75rem">🪣 Seu balde mensal</div>${objs.map(o=>`<div class="obj-bar"><div style="font-size:12px;color:var(--text-muted);width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0">${esc(o.nome)}</div><div class="obj-bar-bg"><div class="obj-bar-fill" style="width:${totalMensal>0?Math.round(((o.pmt||0)/totalMensal)*100):0}%"></div></div><div style="font-size:12px;font-weight:700;white-space:nowrap;flex-shrink:0">${fmt(o.pmt||0)}</div></div>`).join('')}<div style="border-top:1px solid var(--border);margin-top:.75rem;padding-top:.75rem;display:flex;justify-content:space-between"><div style="font-size:13px;font-weight:700">Total mensal</div><div style="font-size:15px;font-weight:800;color:var(--eko-green)">${fmt(totalMensal)}</div></div>${renda>0?`<div style="font-size:12px;margin-top:6px;color:${pctRenda>30?'var(--red)':'var(--text-muted)'}">` + (pctRenda>30?'⚠️':'💡') + ` ${pctRenda}% da sua renda ${pctRenda>30?'— acima do ideal (30%)':'— dentro do recomendado'}</div>`:''}</div>`;}
  else balde.innerHTML='';
  const lista=document.getElementById('objetivos-lista');
  if(!objs.length){lista.innerHTML='<div class="empty-state"><div style="font-size:36px;margin-bottom:.75rem">🏆</div><div>Nenhum objetivo ainda.<br>Toque em <strong>+</strong> para adicionar.</div></div>';return;}
  lista.innerHTML='';
  objs.forEach(obj=>{
    const dt=new Date();dt.setMonth(dt.getMonth()+(obj.meses||0));const conclusao=dt.toLocaleDateString('pt-BR',{month:'short',year:'numeric'});const prazoAnos=Math.floor((obj.meses||0)/12);const prazoMeses=(obj.meses||0)%12;const prazoStr=(prazoAnos>0?prazoAnos+' ano(s) e ':'')+prazoMeses+' meses';
    const saldoAcum = obj.saldoAcumulado || 0;
    const pctAcum = obj.valor > 0 ? Math.min(100, Math.round((saldoAcum / obj.valor) * 100)) : 0;
    const barraAcum = saldoAcum > 0 ? `<div style="margin-bottom:.625rem">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:4px">
        <span>🔗 Meta vinculada: ${fmt(saldoAcum)} acumulado</span><span style="font-weight:700;color:var(--eko-green)">${pctAcum}%</span>
      </div>
      <div class="prog-bg" style="height:6px"><div class="prog-fill" style="width:${pctAcum}%"></div></div>
    </div>` : '';
    const c=document.createElement('div');c.className='card';
    c.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:.625rem"><div style="font-size:15px;font-weight:800;flex:1;margin-right:8px">${esc(obj.nome)}</div><div style="display:flex;align-items:center;gap:6px"><div style="font-size:18px;font-weight:800;color:var(--eko-green);white-space:nowrap">${fmt(obj.pmt||0)}<span style="font-size:11px;font-weight:500;color:var(--text-muted)">/mês</span></div><button onclick="editarObjetivo('${obj._id}')" style="background:none;border:none;cursor:pointer;font-size:15px;color:var(--text-muted)">✏️</button><button onclick="excluirObjetivo('${obj._id}')" style="background:none;border:none;cursor:pointer;font-size:15px;color:var(--text-muted)">🗑️</button></div></div><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:.625rem"><div class="stat-card" style="padding:8px 10px"><div class="slabel">Meta</div><div style="font-size:12px;font-weight:700">${fmt(obj.valor||0)}</div></div><div class="stat-card" style="padding:8px 10px"><div class="slabel">Prazo</div><div style="font-size:12px;font-weight:700">${prazoStr}</div></div></div>${barraAcum}<div style="font-size:12px;color:var(--text-muted);margin-bottom:.625rem">📅 Conclusão estimada: ${conclusao}</div>${obj.obs?`<div style="font-size:12px;color:var(--text-muted);margin-bottom:.625rem">📝 ${esc(obj.obs)}</div>`:''}<button class="btn btn-sm" style="width:100%;margin-top:4px" onclick="gerarMetaDeObjetivo('${obj._id}')">🎯 Criar meta financeira para este objetivo</button>`;
    lista.appendChild(c);
  });
}

window.abrirCriarObjetivo=function(){window._editandoObjetivoId=null;document.getElementById('sheet-obj-title').textContent='Novo objetivo';['obj-nome','obj-valor','obj-saldo','obj-meses','obj-obs'].forEach(id=>document.getElementById(id).value='');document.getElementById('obj-rent').value='1.00';document.getElementById('obj-preview').style.display='none';limparMsg('sheet-obj-msg');abrirOverlay('overlay-objetivo');};
window.salvarObjetivo=async function(){
  const btn=btnDoClique();if(btn)btn.disabled=true;
  try{
  limparMsg('sheet-obj-msg');const nome=document.getElementById('obj-nome').value.trim();const valor=parseMoney(document.getElementById('obj-valor').value);const saldo=parseMoney(document.getElementById('obj-saldo').value)||0;const meses=parseInt(document.getElementById('obj-meses').value);const rent=(parseFloat(document.getElementById('obj-rent').value)||1)/100;const obs=document.getElementById('obj-obs').value.trim();
  if(!nome||!valor||!meses){showMsg('sheet-obj-msg','error','Preencha nome, valor e prazo.');return;}
  const pmt=Math.max(0,calcPMT(saldo,valor,rent,meses));
  if(window._editandoObjetivoId){const objs=await getObjetivos();const obj=objs.find(o=>o._id===window._editandoObjetivoId);if(obj){Object.assign(obj,{nome,valor,saldo,meses,rent:rent*100,pmt,obs});await saveObjetivo(obj);}window._editandoObjetivoId=null;toast('✅ Objetivo atualizado!');}
  else{const obj={nome,valor,saldo,meses,rent:rent*100,pmt,obs,email:store.sessao.email,ordem:Date.now()};await saveObjetivo(obj);toast('✅ Objetivo cadastrado!');}
  fecharOverlay('overlay-objetivo');await renderObjetivos();await renderProntuario();
  }finally{liberarBotao(btn);}
};

window.abrirObjetivos=async function(){try{await renderObjetivos();}catch(e){console.error(e);}ir('screen-objetivos');};

export { getObjetivos };
