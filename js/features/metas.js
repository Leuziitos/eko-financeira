/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/metas.js
 * Metas Financeiras: CRUD (coleção 'metas'), depósitos mensais
 * com ajuste de excedente/déficit, streak, projeção e paginação.
 *
 * saveMeta2 contém o runTransaction que sincroniza saldoAcumulado
 * do objetivo vinculado (origemObjetivoId) — acoplamento por
 * DADOS com objetivos.js, sem import circular.
 * renderProntuario é chamada via ponte window.* até a Fase 5.
 * Corpo movido verbatim; ordem original das faixas preservada.
 * ═══════════════════════════════════════════════════════════ */

import { db, doc, getDoc, setDoc, deleteDoc, collection, getDocs, addDoc, query, where, runTransaction, logEko } from '../core/firebase.js';
import { store } from '../core/store.js';
import { ir } from '../core/router.js';
import { fmt, esc } from '../utils/format.js';
import { parseMoney } from '../utils/money.js';
import { showMsg, limparMsg, toast, abrirOverlay, fecharOverlay } from '../utils/dom.js';
import { cfSugerirLancamento } from './controle.js';

// ── Excluir Meta ─────────────────────────────────────────
window.excluirMetaAtual = async function() {
  if(!confirm('Excluir esta meta permanentemente? Esta ação não pode ser desfeita.')) return;
  try {
    await deleteDoc(doc(db, 'metas', metaAtual._id));
  } catch(e) {
    metaAtual.excluida = true;
    await saveMeta2(metaAtual);
  }
  toast('🗑️ Meta excluída.');
  await renderMetas();
  await renderProntuario();
  ir('screen-metas');
};

async function finalizarMeta() {
  const meta = metaAtual;
  meta.concluida = true;
  meta.concluidaEm = new Date().toISOString();
  await saveMeta2(meta);
  fecharOverlay('overlay-deposito');
  toast('🏆 Parabéns! Meta concluída com sucesso!');
  await renderMetas();
  await renderProntuario();
  ir('screen-metas');
}

// ════════════════════════════════════════════════
// FASE 2 — METAS FINANCEIRAS
// ════════════════════════════════════════════════
let metaAtual=null,mesAtual=null,valorDepositado=0,editandoMeta=null,catSelecionada={icon:'🎯',nome:'Outro'};

function fmtMes(inicio,i){const[a,m]=inicio.split('-').map(Number);return new Date(a,m-1+i,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});}
function prazoFinalMeta(meta){const n=meta.depositos.length;const[a,m]=meta.inicio.split('-').map(Number);return new Date(a,m-1+n-1,1).toLocaleDateString('pt-BR',{month:'short',year:'numeric'});}
function calcAcumulado(meta){return meta.depositos.reduce((s,d)=>s+(d.valor||0),0);}
function calcFaltante(meta){return Math.max(0,meta.meta-calcAcumulado(meta));}

function statusMeta(meta){
  const g=calcAcumulado(meta);if(g>=meta.meta-0.01)return 'concluida';
  const hoje=new Date();
  for(let i=0;i<meta.depositos.length;i++){if(!meta.depositos[i].pago){const[a,m]=meta.inicio.split('-').map(Number);const dt=new Date(a,m-1+i,meta.dia);dt.setHours(23,59,59);if(hoje>dt)return 'atrasada';}}
  return 'andamento';
}
function statusDeposito(meta,i){
  const d=meta.depositos[i];
  if(d.pago&&d.extra)return 'extra';if(d.pago&&d.parcial)return 'parcial';if(d.pago)return 'pago';
  const[a,m]=meta.inicio.split('-').map(Number);const dt=new Date(a,m-1+i,meta.dia);dt.setHours(23,59,59);
  return new Date()>dt?'atrasado':'pendente';
}
function calcStreak(meta){let s=0;for(let i=meta.depositos.length-1;i>=0;i--){if(meta.depositos[i].pago&&!meta.depositos[i].parcial)s++;else break;}return s;}
function calcProjecao(meta){
  const pagos=meta.depositos.filter(d=>d.pago).length;if(pagos===0)return null;
  const acum=calcAcumulado(meta);const taxa=acum/pagos;const falt=calcFaltante(meta);
  if(taxa<=0)return null;const mF=Math.ceil(falt/taxa);const dt=new Date();dt.setMonth(dt.getMonth()+mF);
  return dt.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
}

async function getMetas(){
  try{const q=query(collection(db,'metas'),where('email','==',store.sessao.email));const snap=await getDocs(q);const r=[];snap.forEach(d=>r.push({...d.data(),_id:d.id}));return r.filter(m=>!m.excluida).sort((a,b)=>(a.criadoEm||'')>(b.criadoEm||'')?1:-1);}catch(e){return[];}
}
async function saveMeta2(meta){
  const{_id,...data}=meta;
  if(_id){await setDoc(doc(db,'metas',_id),data);}
  else{data.email=store.sessao.email;data.criadoEm=new Date().toISOString();const ref=await addDoc(collection(db,'metas'),data);meta._id=ref.id;}
  // FASE 4 — sincronizar saldo acumulado com objetivo vinculado via transação (evita race condition)
  if(meta.origemObjetivoId){
    try{
      const acumulado=calcAcumulado(meta);
      const objRef=doc(db,'objetivos',meta.origemObjetivoId);
      await runTransaction(db, async (transaction) => {
        const objSnap=await transaction.get(objRef);
        if(objSnap.exists()){
          transaction.update(objRef,{saldoAcumulado:acumulado});
        }
      });
    }catch(e){console.error('sync objetivo',e);}
  }
}

let metasPagina = 1;
const METAS_POR_PAG = 10;

async function renderMetas(pagina){
  pagina = pagina || 1;
  metasPagina = pagina;
  const metas=await getMetas();
  const ativasTodas=metas.filter(m=>!m.concluida);
  const total=ativasTodas.reduce((s,m)=>s+calcAcumulado(m),0);
  document.getElementById('metas-resumo').innerHTML=metas.length?`<div class="stat-grid"><div class="stat-card"><div class="slabel">Acumulado total</div><div class="sval" style="color:var(--eko-green)">${fmt(total)}</div></div><div class="stat-card"><div class="slabel">Metas ativas</div><div class="sval">${ativasTodas.length}</div></div></div>`:'';
  const lista=document.getElementById('metas-lista');
  if(!ativasTodas.length){lista.innerHTML='<div class="empty-state"><div style="font-size:36px;margin-bottom:.75rem">🎯</div><div>Nenhuma meta ainda.<br>Toque em <strong>+</strong> para criar.</div></div>';return;}
  lista.innerHTML='';
  const exibir = ativasTodas.slice(0, pagina * METAS_POR_PAG);
  exibir.forEach(meta=>{
    const g=calcAcumulado(meta);const f=calcFaltante(meta);const pct=Math.min(100,Math.round((g/meta.meta)*100));
    const st=statusMeta(meta);const streak=calcStreak(meta);
    const c=document.createElement('div');c.className='meta-card '+st;
    c.innerHTML=`<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:.5rem"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:24px">${esc(meta.catIcon||'🎯')}</span><div><div style="font-size:15px;font-weight:800">${esc(meta.nome)}</div><div style="font-size:11px;color:var(--text-muted)">${esc(meta.catNome||'Outro')}</div></div></div><span class="badge ${st==='concluida'?'badge-green':st==='atrasada'?'badge-red':'badge-blue'}">${st==='concluida'?'✅ Concluída':st==='atrasada'?'⚠️ Atrasada':'🎯 Ativa'}</span></div><div class="prog-bg" style="height:7px;margin-bottom:5px"><div class="prog-fill" style="width:${pct}%"></div></div><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:.75rem"><span>${pct}% concluído</span><span>${fmt(g)} de ${fmt(meta.meta)}</span></div>${streak>=2?`<div style="font-size:12px;font-weight:600;color:var(--amber);margin-bottom:.5rem">🔥 ${streak} meses consecutivos!</div>`:''}<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px"><div class="stat-card" style="padding:8px 10px"><div class="slabel">Acumulado</div><div style="font-size:12px;font-weight:700;color:var(--eko-green)">${fmt(g)}</div></div><div class="stat-card" style="padding:8px 10px"><div class="slabel">Faltante</div><div style="font-size:12px;font-weight:700;color:var(--amber)">${fmt(f)}</div></div><div class="stat-card" style="padding:8px 10px"><div class="slabel">Por mês</div><div style="font-size:12px;font-weight:700">${fmt(meta.mensal)}</div></div></div>`;
    c.onclick=()=>abrirMetaDetalhe(meta._id);lista.appendChild(c);
  });
  // Botão "Carregar mais"
  if(exibir.length < ativasTodas.length){
    const btn=document.createElement('button');
    btn.className='btn';btn.style='width:100%;margin-top:.75rem';
    btn.textContent=`Carregar mais (${ativasTodas.length - exibir.length} restantes)`;
    btn.onclick=()=>renderMetas(pagina+1);
    lista.appendChild(btn);
  }
}

async function abrirMetaDetalhe(id){const metas=await getMetas();metaAtual={...metas.find(m=>m._id===id)};renderMetaDetalhe();ir('screen-meta-detalhe');}

function renderMetaDetalhe(){
  const meta=metaAtual;const g=calcAcumulado(meta);const f=calcFaltante(meta);
  const pagos=meta.depositos.filter(d=>d.pago).length;const pct=Math.min(100,Math.round((g/meta.meta)*100));
  const streak=calcStreak(meta);const projecao=calcProjecao(meta);
  document.getElementById('det-cat-label').textContent=(meta.catIcon||'🎯')+' '+(meta.catNome||'Outro');
  document.getElementById('det-meta-nome').textContent=meta.nome;
  document.getElementById('det-streak').innerHTML=streak>=2?`<span style="font-size:13px;font-weight:600;color:var(--amber)">🔥 ${streak} meses consecutivos!</span>`:'';
  document.getElementById('det-acumulado-label').textContent=fmt(g)+' acumulados';
  document.getElementById('det-pct').textContent=pct+'%';
  document.getElementById('det-barra-meta').style.width=pct+'%';
  document.getElementById('det-projecao').innerHTML=projecao?`📅 No seu ritmo atual você conclui esta meta em <strong>${projecao}</strong>`:'';
  document.getElementById('dm-meta').textContent=fmt(meta.meta);document.getElementById('dm-mensal').textContent=fmt(meta.mensal);
  document.getElementById('dm-acumulado').textContent=fmt(g);document.getElementById('dm-faltante').textContent=fmt(f);
  document.getElementById('dm-pagos').textContent=pagos+' de '+meta.depositos.length;document.getElementById('dm-prazo').textContent=prazoFinalMeta(meta);
  const lista=document.getElementById('det-lista-depositos');lista.innerHTML='';
  meta.depositos.forEach((dep,i)=>{
    const st=statusDeposito(meta,i);
    const labels={pago:'Pago',parcial:'Parcial',pendente:'Pendente',atrasado:'Atrasado',extra:'Aporte extra'};
    const icons2={pago:'✅',parcial:'⚠️',pendente:'⏳',atrasado:'🔴',extra:'⭐'};
    const sub=dep.pago?'Acumulado: '+fmt(dep.valor):'Previsto: '+fmt(meta.mensal);
    const item=document.createElement('div');item.className='mes-item '+st;
    item.innerHTML=`<div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:7px;margin-bottom:3px;flex-wrap:wrap"><span style="font-size:13px;font-weight:700">Mês ${i+1} · dia ${meta.dia}</span><span class="badge badge-${st==='pago'||st==='extra'?'green':st==='parcial'?'amber':st==='atrasado'?'red':'gray'}">${icons2[st]} ${labels[st]}</span></div><div style="font-size:12px;color:var(--text-muted)">${fmtMes(meta.inicio,i)} · ${esc(sub)}</div></div><button class="btn btn-sm ${dep.pago?'':'btn-primary'}" onclick="abrirDeposito(${i})">${dep.pago?'✓ Editar':'Depositar'}</button>`;
    lista.appendChild(item);
  });
}

window.voltarMetas=async function(){await renderMetas();ir('screen-metas');};
window.selecionarCat=function(icon,nome){catSelecionada={icon,nome};document.querySelectorAll('.cat-btn').forEach(b=>b.classList.remove('selected'));event.currentTarget.classList.add('selected');};
window.abrirCriarMeta=function(){editandoMeta=null;catSelecionada={icon:'🎯',nome:'Outro'};document.getElementById('sheet-meta-title').textContent='🎯 Nova meta';['meta-nome','meta-valor','meta-meses','meta-dia'].forEach(id=>document.getElementById(id).value='');document.getElementById('meta-inicio').value=new Date().toISOString().slice(0,7);document.querySelectorAll('.cat-btn').forEach(b=>b.classList.remove('selected'));limparMsg('sheet-meta-msg');abrirOverlay('overlay-meta');};
window.abrirEditarMeta=function(){
  editandoMeta=metaAtual._id;
  catSelecionada={icon:metaAtual.catIcon||'🎯', nome:metaAtual.catNome||'Outro'};
  document.getElementById('sheet-meta-title').textContent='✏️ Editar meta';
  document.getElementById('meta-nome').value=metaAtual.nome;
  document.getElementById('meta-valor').value=metaAtual.meta;
  document.getElementById('meta-meses').value=metaAtual.depositos.length;
  document.getElementById('meta-inicio').value=metaAtual.inicio;
  document.getElementById('meta-dia').value=metaAtual.dia;
  // Highlight selected category
  document.querySelectorAll('.cat-btn').forEach(b=>{
    const lbl=b.querySelector('.cat-btn-label');
    if(lbl&&lbl.textContent===catSelecionada.nome) b.classList.add('selected');
    else b.classList.remove('selected');
  });
  limparMsg('sheet-meta-msg');
  abrirOverlay('overlay-meta');
};
window.salvarMeta=async function(){
  limparMsg('sheet-meta-msg');
  const nome=document.getElementById('meta-nome').value.trim();const val=parseMoney(document.getElementById('meta-valor').value);const meses=parseInt(document.getElementById('meta-meses').value);const inicio=document.getElementById('meta-inicio').value;const dia=parseInt(document.getElementById('meta-dia').value);
  if(!nome||!val||!meses||!inicio||!dia||dia<1||dia>28){showMsg('sheet-meta-msg','error','Preencha todos os campos. Dia entre 1 e 28.');return;}
  if(editandoMeta){const deps=metaAtual.depositos.slice(0,meses);while(deps.length<meses)deps.push({pago:false,parcial:false,extra:false,valor:0});Object.assign(metaAtual,{nome,meta:val,meses,dia,inicio,mensal:val/meses,catIcon:catSelecionada.icon,catNome:catSelecionada.nome,depositos:deps});await saveMeta2(metaAtual);fecharOverlay('overlay-meta');renderMetaDetalhe();}
  else{const deps=Array(meses).fill(null).map(()=>({pago:false,parcial:false,extra:false,valor:0}));const nova={nome,meta:val,meses,dia,inicio,mensal:val/meses,catIcon:catSelecionada.icon,catNome:catSelecionada.nome,saldoExtra:0,depositos:deps,email:store.sessao.email};await saveMeta2(nova);fecharOverlay('overlay-meta');await renderMetas();logEko('meta_criada');toast('✅ Meta criada!');}
  await renderProntuario();
};
window.resetarMetaAtual=async function(){if(!confirm('Resetar esta meta?'))return;const n=metaAtual.depositos.length;metaAtual.depositos=Array(n).fill(null).map(()=>({pago:false,parcial:false,extra:false,valor:0}));metaAtual.mensal=metaAtual.meta/n;metaAtual.saldoExtra=0;await saveMeta2(metaAtual);renderMetaDetalhe();toast('Meta resetada.');};

window.abrirDeposito=function(i){
  mesAtual=i;const meta=metaAtual;const dep=meta.depositos[i];
  document.getElementById('dep-titulo').textContent='Mês '+(i+1)+' · '+fmtMes(meta.inicio,i);
  document.getElementById('dep-subtitulo').textContent='Valor previsto: '+fmt(meta.mensal);
  document.getElementById('dep-valor').value=dep.pago?dep.valor:'';
  document.getElementById('dep-fase1').style.display='block';document.getElementById('dep-fase2').style.display='none';
  abrirOverlay('overlay-deposito');
};
window.confirmarDeposito=async function(){
  const val=parseMoney(document.getElementById('dep-valor').value)||0;const meta=metaAtual;const previsto=meta.mensal;valorDepositado=val;
  if(Math.abs(val-previsto)<0.01){meta.depositos[mesAtual]={pago:true,parcial:false,extra:false,valor:val};await saveMeta2(meta);fecharOverlay('overlay-deposito');const pct=Math.min(100,Math.round((calcAcumulado(meta)/meta.meta)*100));toast('🎉 Atualizado! Você concluiu '+pct+'% desta meta.');renderMetaDetalhe();if(val>0)setTimeout(()=>cfSugerirLancamento('gasto',val,'metas','🎯 Metas'),600);}
  else if(val>previsto){meta.depositos[mesAtual]={pago:true,parcial:false,extra:true,valor:val};await saveMeta2(meta);mostrarFase2Extra(val-previsto);}
  else if(val>0){meta.depositos[mesAtual]={pago:true,parcial:true,extra:false,valor:val};await saveMeta2(meta);mostrarFase2Deficit(previsto-val);}
  else{window.naoConseguiu();}
};
window.naoConseguiu=async function(){const meta=metaAtual;meta.depositos[mesAtual]={pago:true,parcial:true,extra:false,valor:0};await saveMeta2(meta);mostrarFase2Deficit(meta.mensal);};

function mostrarFase2Extra(diff){
  const meta=metaAtual;const acumulado=calcAcumulado(meta);const futuros=meta.depositos.filter((_,i)=>i>mesAtual&&!meta.depositos[i].pago).length;
  const faltante=calcFaltante(meta);const novoMensal=futuros>0?faltante/futuros:0;const mesesExtras=meta.mensal>0?Math.floor(diff/meta.mensal):0;const metaAtingida=acumulado>=meta.meta;
  document.getElementById('dep-diff-banner').innerHTML=`<div class="diff-positivo">🎉 Você acumulou <strong>${fmt(diff)}</strong> a mais!</div>`;
  document.getElementById('dep-pergunta').textContent='O que deseja fazer com esse valor extra?';document.getElementById('dep-subpergunta').textContent='';
  const opcoes=[];
  if(metaAtingida)opcoes.push({val:'finalizar',titulo:'🏆 Finalizar meta agora',desc:'Seu valor acumulado já cobre a meta! Marcar como concluída.',disabled:false,destaque:true});
  opcoes.push({val:'diminuir-parcelas',titulo:'Diminuir os próximos aportes',desc:futuros>0?'Novo valor: '+fmt(novoMensal)+'/mês':'Sem meses futuros',disabled:futuros===0},{val:'diminuir-prazo',titulo:'Antecipar a conclusão',desc:mesesExtras>0?'Concluir ~'+mesesExtras+' mês(es) antes':'Valor insuficiente',disabled:mesesExtras===0},{val:'aumentar-meta',titulo:'Aumentar o valor final',desc:'Nova meta: '+fmt(meta.meta+diff),disabled:false},{val:'saldo-extra',titulo:'Guardar como saldo extra',desc:'Reserva de '+fmt(diff),disabled:false});
  renderOpcoes(opcoes);document.getElementById('dep-fase1').style.display='none';document.getElementById('dep-fase2').style.display='block';
}
function mostrarFase2Deficit(diff){
  const meta=metaAtual;const futuros=meta.depositos.filter((_,i)=>i>mesAtual&&!meta.depositos[i].pago).length;
  const faltante=calcFaltante(meta);const novoMensal=futuros>0?faltante/futuros:0;const mesesExtras=meta.mensal>0?Math.ceil(diff/meta.mensal):1;
  document.getElementById('dep-diff-banner').innerHTML=`<div class="diff-negativo">⚠️ Você acumulou <strong>${fmt(diff)}</strong> a menos.</div>`;
  document.getElementById('dep-pergunta').textContent='Como deseja ajustar sua meta?';document.getElementById('dep-subpergunta').textContent='';
  renderOpcoes([{val:'redistribuir',titulo:'Redistribuir nos próximos meses',desc:futuros>0?'Novo valor: '+fmt(novoMensal)+'/mês':'Sem meses futuros',disabled:futuros===0},{val:'prazo',titulo:'Aumentar o prazo',desc:'Adicionar ~'+mesesExtras+' mês(es)',disabled:false}]);
  document.getElementById('dep-fase1').style.display='none';document.getElementById('dep-fase2').style.display='block';
}
function renderOpcoes(opcoes){document.getElementById('dep-opcoes').innerHTML=opcoes.map(o=>`<label class="radio-opt" style="${o.disabled?'opacity:.4;pointer-events:none':''}${o.destaque?';border-color:var(--eko-green);background:var(--eko-green-light)':''}" onclick="${o.disabled?'':'selecionarOpcaoDeposito(this)'}"><input type="radio" name="ajuste" value="${o.val}" ${o.disabled?'disabled':''}><div><div style="font-size:14px;font-weight:700;color:${o.destaque?'var(--eko-green-dark)':'inherit'}">${o.titulo}</div><div style="font-size:12px;color:var(--text-muted);margin-top:2px">${o.desc}</div></div></label>`).join('');}
window.selecionarOpcaoDeposito=function(el){document.querySelectorAll('#dep-opcoes .radio-opt').forEach(o=>o.classList.remove('selected'));el.classList.add('selected');el.querySelector('input').checked=true;};
window.aplicarAjuste=async function(){
  const sel=document.querySelector('input[name="ajuste"]:checked');if(!sel){toast('Escolha uma opção.');return;}
  const meta=metaAtual;const v=sel.value;const faltante=calcFaltante(meta);
  const futuros=meta.depositos.map((_,i)=>i).filter(i=>i>mesAtual&&!meta.depositos[i].pago);const diff=Math.abs(valorDepositado-meta.mensal);
  if(v==='finalizar'){await finalizarMeta();return;}
  else if(v==='diminuir-parcelas'||v==='redistribuir'){if(futuros.length>0)meta.mensal=faltante/futuros.length;}
  else if(v==='diminuir-prazo'){const mr=Math.floor(diff/meta.mensal);let rem=0;for(let k=meta.depositos.length-1;k>=0&&rem<mr;k--){if(!meta.depositos[k].pago){meta.depositos.splice(k,1);rem++;}}}
  else if(v==='aumentar-meta'){meta.meta+=diff;if(futuros.length>0)meta.mensal=faltante/futuros.length;}
  else if(v==='saldo-extra'){meta.saldoExtra=(meta.saldoExtra||0)+diff;}
  else if(v==='prazo'){const me=Math.ceil(diff/meta.mensal);for(let k=0;k<me;k++)meta.depositos.push({pago:false,parcial:false,extra:false,valor:0});}
  await saveMeta2(meta);fecharOverlay('overlay-deposito');const pct=Math.min(100,Math.round((calcAcumulado(meta)/meta.meta)*100));toast('✅ Meta ajustada! '+pct+'% concluído.');renderMetaDetalhe();
  if(valorDepositado>0)setTimeout(()=>cfSugerirLancamento('gasto',valorDepositado,'metas','🎯 Metas'),600);
};

window.abrirMetas=async function(){
  try{await renderMetas();}catch(e){console.error(e);}
  ir('screen-metas');
  // Verificar reserva e mostrar aviso se incompleta
  try {
    const snap = await getDoc(doc(db,'reserva',store.sessao.email));
    const avisoEl = document.getElementById('metas-aviso-reserva');
    if(avisoEl){
      if(!snap.exists() || (snap.data().saldoAtual < snap.data().meta)){
        avisoEl.style.display='';
      } else {
        avisoEl.style.display='none';
      }
    }
  } catch(e){}
};

export { getMetas, saveMeta2, calcAcumulado, statusMeta, renderMetas };
