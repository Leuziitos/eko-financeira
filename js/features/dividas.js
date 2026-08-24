/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/dividas.js
 * Minhas Dívidas: CRUD (coleção 'dividas'), priorização por
 * juros, pagamento de parcela/parcial, amortização extra e
 * fluxo de quitação (com sugestão de criar meta com o valor
 * liberado — handshake via window._metaPreenchida e
 * window.abrirMetas/abrirCriarMeta registrados por metas.js).
 * renderProntuario via ponte window.* até a Fase 5.
 * Corpo movido verbatim; ordem original das faixas preservada.
 * ═══════════════════════════════════════════════════════════ */

import { db, doc, setDoc, deleteDoc, collection, getDocs, addDoc, query, where } from '../core/firebase.js';
import { store, cache } from '../core/store.js';
import { ir } from '../core/router.js';
import { fmt, esc } from '../utils/format.js';
import { parseMoney } from '../utils/money.js';
import { showMsg, limparMsg, toast, abrirOverlay, fecharOverlay, btnDoClique, liberarBotao } from '../utils/dom.js';
import { cfSugerirLancamento } from './controle.js';
import { renderProntuario } from './prontuario.js';

// ── Dívida Quitada ───────────────────────────────────────
async function verificarDividaQuitada(div) {
  if((div.parcelasRestantes||0) <= 0) {
    const acao = confirm('🎉 Parabéns! Dívida quitada!\n\nDeseja excluir esta dívida da lista?');
    if(acao) {
      try {
        await deleteDoc(doc(db, 'dividas', div._id));
      } catch(e) { div.excluida = true; await saveDivida2(div); }
      toast('🎉 Dívida quitada e removida!');
    } else {
      div.quitada = true;
      await saveDivida2(div);
      toast('🎉 Dívida quitada! Mantida no histórico.');
    }
    cache.invalidar('dividas');
    await renderDividas();
    await renderProntuario();
    // FASE 4 — sugerir criar meta com o valor liberado
    const parcela = div.parcela || 0;
    if (parcela > 0) {
      setTimeout(() => {
        const criar = confirm(
          `💡 Você liberou ${fmt(parcela)}/mês!\n\nQuer criar uma meta financeira com esse valor?\n\nÉ a hora de transformar o que era dívida em patrimônio! 🚀`
        );
        if (criar) {
          window._metaPreenchida = { valor: null, meses: 12, mensal: parcela, nome: 'Investir o valor da ' + (div.nome || 'dívida quitada') };
          abrirMetas().then(() => {
            setTimeout(() => {
              abrirCriarMeta();
              if (window._metaPreenchida) {
                const ni = document.getElementById('meta-nome');
                const nv = document.getElementById('meta-meses');
                if (ni) ni.value = window._metaPreenchida.nome;
                if (nv) nv.value = window._metaPreenchida.meses;
                window._metaPreenchida = null;
              }
            }, 300);
          });
        }
      }, 600);
    }
    return true;
  }
  return false;
}

// ════════════════════════════════════════════════
// FASE 2 — DÍVIDAS
// ════════════════════════════════════════════════
let dividaAtual=null,tipoDividaSel={icon:'💳',nome:'Cartão'};
window.selecionarTipoDivida=function(icon,nome){tipoDividaSel={icon,nome};document.querySelectorAll('.tipo-btn').forEach(b=>b.classList.remove('selected'));event.currentTarget.classList.add('selected');};
window.calcularTotalDivida=function(){
  const parc=parseMoney(document.getElementById('divida-parcela').value)||0;
  const total=parseInt(document.getElementById('divida-total-parcelas').value)||0;
  const jaPago=parseMoney(document.getElementById('divida-ja-pago').value)||0;
  const el=document.getElementById('divida-total-calc');
  if(parc>0&&total>0){
    const totalDivida=parc*total;
    const parcelasJaPagas=jaPago>0?Math.round(jaPago/parc):0;
    const restantes=Math.max(0,total-parcelasJaPagas);
    const aAinda=parc*restantes;
    el.style.display='block';
    el.innerHTML=`Total da dívida: <strong>${fmt(totalDivida)}</strong> · Pago: <strong>${fmt(jaPago)}</strong> · Faltam: <strong>${restantes}x</strong> (${fmt(aAinda)})`;
    // Atualiza campo de parcelas restantes (oculto)
    let hidden=document.getElementById('divida-parcelas-restantes');
    if(!hidden){hidden=document.createElement('input');hidden.type='hidden';hidden.id='divida-parcelas-restantes';document.getElementById('overlay-divida').appendChild(hidden);}
    hidden.value=restantes;
  }else el.style.display='none';
};

async function getDividas(){
  if(cache.dividas) return cache.dividas;
  try{const q=query(collection(db,'dividas'),where('email','==',store.sessao.email));const snap=await getDocs(q);const r=[];snap.forEach(d=>r.push({...d.data(),_id:d.id}));cache.dividas=r.filter(d=>!d.excluida).sort((a,b)=>((b.juros||0)-(a.juros||0)));return cache.dividas;}catch(e){return[];}
}
async function saveDivida2(divida){const{_id,...data}=divida;if(_id){await setDoc(doc(db,'dividas',_id),data);}else{data.email=store.sessao.email;data.criadoEm=new Date().toISOString();const ref=await addDoc(collection(db,'dividas'),data);divida._id=ref.id;}cache.invalidar('dividas');}

function statusDivida(divida){
  if(divida.emAtraso)return 'atrasada';
  const agora=new Date();const mesAtualStr=agora.getFullYear()+'-'+(agora.getMonth()+1).toString().padStart(2,'0');
  const hist=divida.historicoPagamentos||[];
  const pagouEsteMes=hist.some(h=>{if(h.tipo==='nao_pago')return false;const d=new Date(h.data);const mesH=d.getFullYear()+'-'+(d.getMonth()+1).toString().padStart(2,'0');return mesH===mesAtualStr&&h.valor>0;});
  if(pagouEsteMes)return 'emdia';
  const hoje2=new Date();const venc=new Date(hoje2.getFullYear(),hoje2.getMonth(),divida.vencimento);if(hoje2>venc)return 'atrasada';
  const diff2=venc-hoje2;const dias=Math.ceil(diff2/(1000*60*60*24));if(dias<=5)return 'vencendo';
  return 'pendente';
}

async function renderDividas(){
  const dividas=await getDividas();
  const totalDevido=dividas.reduce((s,d)=>s+(d.parcela*(d.parcelasRestantes||0)),0);
  const emAtraso=dividas.filter(d=>d.emAtraso).reduce((s,d)=>s+(d.valorAtrasado||0),0);
  const emDia=dividas.filter(d=>statusDivida(d)==='emdia').length;
  const pendentes=dividas.filter(d=>statusDivida(d)==='pendente'||statusDivida(d)==='vencendo').length;
  document.getElementById('dividas-resumo').innerHTML=dividas.length?`<div class="stat-grid"><div class="stat-card"><div class="slabel">Total a pagar</div><div class="sval" style="color:var(--red)">${fmt(totalDevido)}</div></div><div class="stat-card"><div class="slabel">Em atraso</div><div class="sval" style="color:var(--amber)">${fmt(emAtraso)}</div></div></div><div style="display:flex;gap:8px;margin-bottom:.75rem;font-size:12px;font-weight:600"><span style="color:var(--eko-green)">✅ ${emDia} em dia</span><span style="color:var(--text-muted)">·</span><span style="color:var(--text-muted)">⏳ ${pendentes} pendente(s)</span>${emAtraso>0?`<span style="color:var(--text-muted)">·</span><span style="color:var(--red)">🔴 ${dividas.filter(d=>d.emAtraso).length} em atraso</span>`:''}</div>`:'';
  const lista=document.getElementById('dividas-lista');
  if(!dividas.length){lista.innerHTML='<div class="empty-state"><div style="font-size:36px;margin-bottom:.75rem">💳</div><div>Nenhuma dívida cadastrada.<br>Toque em <strong>+</strong> para adicionar.</div></div>';return;}
  lista.innerHTML='';
  dividas.forEach((div,idx)=>{
    const st=statusDivida(div);const total=div.parcela*(div.parcelasRestantes||0);
    const stLabel={emdia:'✅ Em dia',atrasada:'🔴 Atrasada',vencendo:'⚠️ Vencendo',pendente:'⏳ Pendente'}[st]||'⏳ Pendente';
    const stBadge={emdia:'badge-green',atrasada:'badge-red',vencendo:'badge-amber',pendente:'badge-gray'}[st]||'badge-gray';
    const c=document.createElement('div');c.className='divida-card '+(idx===0&&dividas.length>1?'prioridade1 ':'')+st;
    c.innerHTML=`<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:.625rem"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:22px">${esc(div.tipoIcon||'💳')}</span><div><div style="font-size:15px;font-weight:800">${esc(div.nome)}</div><div style="font-size:11px;color:var(--text-muted)">${esc(div.credor||'')}</div></div></div><div style="display:flex;align-items:center;gap:6px"><span class="badge ${stBadge}">${stLabel}</span><button onclick="excluirDivida('${div._id}')" style="background:none;border:none;cursor:pointer;font-size:16px;padding:2px;color:var(--text-muted)" title="Excluir">🗑️</button></div></div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:.75rem"><div class="stat-card" style="padding:8px 10px"><div class="slabel">Parcela/mês</div><div style="font-size:12px;font-weight:700">${fmt(div.parcela)}</div></div><div class="stat-card" style="padding:8px 10px"><div class="slabel">Parcelas restantes</div><div style="font-size:12px;font-weight:700">${div.parcelasRestantes||0}x</div></div><div class="stat-card" style="padding:8px 10px"><div class="slabel">Juros</div><div style="font-size:12px;font-weight:700;color:var(--red)">${div.juros||0}% a.m.</div></div></div><div style="display:flex;justify-content:space-between;align-items:center"><div style="font-size:12px;color:var(--text-muted)">💰 <strong>A pagar: ${fmt(total)}</strong> · Vence dia ${div.vencimento||'--'}</div><button class="btn btn-sm btn-primary" onclick="abrirPagamento('${div._id}')">Registrar pagamento</button></div>`;
    lista.appendChild(c);
  });
}

window.editarDivida=async function(id){
  const dividas=await getDividas();
  const div=dividas.find(d=>d._id===id);
  if(!div)return;
  tipoDividaSel={icon:div.tipoIcon||'💳',nome:div.tipoNome||'Cartão'};
  document.getElementById('sheet-divida-title').textContent='✏️ Editar dívida';
  document.getElementById('divida-nome').value=div.nome||'';
  document.getElementById('divida-credor').value=div.credor||'';
  document.getElementById('divida-parcela').value=div.parcela||'';
  document.getElementById('divida-total-parcelas').value=div.totalParc||div.parcelasRestantes||'';
  document.getElementById('divida-parcelas-restantes').value=div.parcelasRestantes||'';
  document.getElementById('divida-juros').value=div.juros||'';
  document.getElementById('divida-vencimento').value=div.vencimento||'';
  // Highlight tipo
  document.querySelectorAll('.tipo-btn').forEach(b=>{
    const lbl=b.querySelector('.tipo-btn-label');
    if(lbl&&lbl.textContent===tipoDividaSel.nome)b.classList.add('selected');
    else b.classList.remove('selected');
  });
  calcularTotalDivida();
  limparMsg('sheet-divida-msg');
  window._editandoDividaId=id;
  abrirOverlay('overlay-divida');
};

window.abrirCriarDivida=function(){tipoDividaSel={icon:'💳',nome:'Cartão'};window._editandoDividaId=null;document.getElementById('sheet-divida-title').textContent='Nova dívida';['divida-nome','divida-credor','divida-parcela','divida-total-parcelas','divida-ja-pago','divida-juros','divida-vencimento'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});document.getElementById('divida-total-calc').style.display='none';document.querySelectorAll('.tipo-btn').forEach(b=>b.classList.remove('selected'));limparMsg('sheet-divida-msg');abrirOverlay('overlay-divida');};
window.salvarDivida=async function(){
  const btn=btnDoClique();if(btn)btn.disabled=true;
  try{
  limparMsg('sheet-divida-msg');
  const nome=document.getElementById('divida-nome').value.trim();const credor=document.getElementById('divida-credor').value.trim();const parcela=parseMoney(document.getElementById('divida-parcela').value);const restantes=parseInt(document.getElementById('divida-parcelas-restantes').value);const juros=parseFloat(document.getElementById('divida-juros').value);const vencimento=parseInt(document.getElementById('divida-vencimento').value);
  if(!nome||!parcela||!restantes||!juros||!vencimento){showMsg('sheet-divida-msg','error','Preencha todos os campos obrigatórios.');return;}
  if(vencimento<1||vencimento>28){showMsg('sheet-divida-msg','error','Dia entre 1 e 28.');return;}
  const divida={nome,credor,tipoIcon:tipoDividaSel.icon,tipoNome:tipoDividaSel.nome,parcela,parcelasRestantes:restantes,juros,vencimento,emAtraso:false,valorAtrasado:0,historicoPagamentos:[],email:store.sessao.email};
  await saveDivida2(divida);fecharOverlay('overlay-divida');await renderDividas();toast('✅ Dívida cadastrada!');await renderProntuario();
  }finally{liberarBotao(btn);}
};
window.excluirDivida=async function(id){
  if(!confirm('Excluir esta dívida?'))return;
  try{await deleteDoc(doc(db,'dividas',id));}catch(e){const dividas=await getDividas();const div=dividas.find(d=>d._id===id);if(div){div.excluida=true;await saveDivida2(div);}}
  cache.invalidar('dividas');
  await renderDividas();toast('🗑️ Dívida excluída.');await renderProntuario();
};

// PAGAMENTO
let tipoPagSel='parcela',amortOpcaoSel='parcelas';
window.selecionarTipoPag=function(el,val){tipoPagSel=val;document.querySelectorAll('#pag-fase1 .radio-opt').forEach(o=>o.classList.remove('selected'));el.classList.add('selected');el.querySelector('input').checked=true;};
window.avancarTipoPag=function(){
  if(!document.querySelector('input[name="tipopag"]:checked')){toast('Escolha uma opção.');return;}
  document.getElementById('pag-fase1').style.display='none';
  if(tipoPagSel==='parcela'){document.getElementById('pag-fase2a').style.display='block';document.getElementById('pag-valor').value='';document.getElementById('pag-alerta').style.display='none';}
  else{document.getElementById('pag-fase2b').style.display='block';const div=dividaAtual;const totalRestante=div.parcela*(div.parcelasRestantes||0);document.getElementById('pag-info-amort').innerHTML=`Dívida atual: <strong>${fmt(totalRestante)}</strong> restante<br>${div.parcelasRestantes||0} parcelas de <strong>${fmt(div.parcela)}</strong>`;document.getElementById('pag-amort-valor').value='';document.getElementById('pag-amort-preview').style.display='none';document.getElementById('pag-amort-opcoes').style.display='none';}
};
window.voltarFase1Pag=function(){document.getElementById('pag-fase1').style.display='block';document.getElementById('pag-fase2a').style.display='none';document.getElementById('pag-fase2b').style.display='none';document.querySelectorAll('#pag-fase1 .radio-opt').forEach(o=>o.classList.remove('selected'));document.querySelectorAll('input[name="tipopag"]').forEach(i=>i.checked=false);};
window.calcularAlertaAtraso=function(){const div=dividaAtual;if(!div)return;const val=parseMoney(document.getElementById('pag-valor').value)||0;const el=document.getElementById('pag-alerta');if(val>0&&val<div.parcela){const diff=div.parcela-val;const jurosExtra=diff*(div.juros/100);el.style.display='block';el.textContent='⚠️ Diferença de '+fmt(diff)+' pode gerar ~'+fmt(jurosExtra)+' em juros extras ('+div.juros+'% a.m.)';}else el.style.display='none';};
window.calcularAmortizacao=function(){
  const div=dividaAtual;if(!div)return;const amort=parseMoney(document.getElementById('pag-amort-valor').value)||0;
  if(amort<=0){document.getElementById('pag-amort-preview').style.display='none';document.getElementById('pag-amort-opcoes').style.display='none';return;}
  const totalAtual=div.parcela*(div.parcelasRestantes||0);const totalNovo=Math.max(0,totalAtual-amort);
  const parcelasNovo=Math.max(0,Math.floor(totalNovo/div.parcela));const parcelasReduzidas=(div.parcelasRestantes||0)-parcelasNovo;const novaParc=div.parcelasRestantes>0?totalNovo/div.parcelasRestantes:0;
  document.getElementById('pag-amort-desc-parcelas').textContent=parcelasReduzidas>0?`Reduz de ${div.parcelasRestantes} para ${parcelasNovo} parcelas — Total: ${fmt(totalNovo)}`:'Amortização insuficiente para eliminar uma parcela';
  document.getElementById('pag-amort-desc-valor').textContent=`Parcela reduz de ${fmt(div.parcela)} para ${fmt(novaParc)} — Prazo mantido (${div.parcelasRestantes} parcelas)`;
  document.getElementById('pag-amort-preview').style.display='block';document.getElementById('pag-amort-preview').innerHTML=`<div style="font-size:13px;font-weight:600;color:var(--eko-green);margin-bottom:4px">💰 Amortização de ${fmt(amort)}</div><div style="font-size:12px;color:var(--text-muted);line-height:1.7">Total atual: ${fmt(totalAtual)}<br>Novo total: <strong>${fmt(totalNovo)}</strong><br>Economia em juros: ~${fmt(amort*(div.juros/100))} por mês</div>`;
  document.getElementById('pag-amort-opcoes').style.display='flex';document.getElementById('pag-amort-opcoes').style.flexDirection='column';document.getElementById('pag-amort-opcoes').style.gap='8px';
};
window.selecionarOpcaoAmort=function(el,val){amortOpcaoSel=val;document.querySelectorAll('#pag-amort-opcoes .radio-opt').forEach(o=>o.classList.remove('selected'));el.classList.add('selected');el.querySelector('input').checked=true;};
window.confirmarAmortizacao=async function(){
  const div=dividaAtual;const amort=parseMoney(document.getElementById('pag-amort-valor').value)||0;
  if(amort<=0){toast('Informe o valor da amortização.');return;}
  if(!document.querySelector('input[name="amortOpt"]:checked')){toast('Escolha como aplicar a amortização.');return;}
  const totalAtual=div.parcela*(div.parcelasRestantes||0);const totalNovo=Math.max(0,totalAtual-amort);
  if(amortOpcaoSel==='parcelas'){div.parcelasRestantes=Math.max(0,Math.floor(totalNovo/div.parcela));}
  else{if(div.parcelasRestantes>0)div.parcela=totalNovo/div.parcelasRestantes;}
  if(!div.historicoPagamentos)div.historicoPagamentos=[];div.historicoPagamentos.push({tipo:'amortizacao',valor:amort,data:new Date().toISOString(),opcao:amortOpcaoSel});div.emAtraso=false;div.valorAtrasado=0;
  await saveDivida2(div);fecharOverlay('overlay-pagamento');await renderDividas();toast('✅ Amortização aplicada! Total restante: '+fmt(div.parcela*div.parcelasRestantes));
};
window.abrirPagamento=async function(id){
  const dividas=await getDividas();dividaAtual=dividas.find(d=>d._id===id);
  document.getElementById('pag-titulo').textContent=dividaAtual.tipoIcon+' '+dividaAtual.nome;document.getElementById('pag-subtitulo').textContent='Parcela: '+fmt(dividaAtual.parcela)+' · Vence dia '+dividaAtual.vencimento;
  document.getElementById('pag-fase1').style.display='block';document.getElementById('pag-fase2a').style.display='none';document.getElementById('pag-fase2b').style.display='none';
  document.querySelectorAll('#pag-fase1 .radio-opt').forEach(o=>o.classList.remove('selected'));document.querySelectorAll('input[name="tipopag"]').forEach(i=>i.checked=false);
  const hist=dividaAtual.historicoPagamentos||[];const histDiv=document.getElementById('pag-historico');const histLista=document.getElementById('pag-historico-lista');
  if(hist.length){histDiv.style.display='block';histLista.innerHTML=hist.slice(-5).reverse().map(h=>`<div class="pront-item" style="margin-bottom:6px"><div><div style="font-size:13px;font-weight:600">${h.tipo==='amortizacao'?'💰 Amortização':h.tipo==='nao_pago'?'❌ Não pago':'💳 Parcela'} — ${fmt(h.valor)}</div><div style="font-size:11px;color:var(--text-muted)">${new Date(h.data).toLocaleDateString('pt-BR')}${h.tipo==='amortizacao'?' · '+(h.opcao==='parcelas'?'Reduziu parcelas':'Reduziu valor'):''}</div></div></div>`).join('');}
  else histDiv.style.display='none';
  abrirOverlay('overlay-pagamento');
};
window.confirmarPagamento=async function(){
  const btn=btnDoClique();if(btn)btn.disabled=true;
  try{
  const val=parseMoney(document.getElementById('pag-valor').value)||0;const div=dividaAtual;
  if(!div.historicoPagamentos)div.historicoPagamentos=[];
  if(val>=div.parcela){div.parcelasRestantes=Math.max(0,(div.parcelasRestantes||1)-1);div.emAtraso=false;div.valorAtrasado=0;div.historicoPagamentos.push({tipo:'parcela',valor:val,data:new Date().toISOString()});}
  else if(val>0){div.emAtraso=true;div.valorAtrasado=div.parcela-val;div.historicoPagamentos.push({tipo:'parcela_parcial',valor:val,data:new Date().toISOString()});}
  await saveDivida2(div);const quitada=await verificarDividaQuitada(div);
  if(!quitada){fecharOverlay('overlay-pagamento');await renderDividas();toast(val>=div.parcela?'✅ Parcela registrada! Restam '+div.parcelasRestantes+'x':'⚠️ Pagamento parcial registrado.');if(val>0)setTimeout(()=>cfSugerirLancamento('gasto',val,'dividas','💳 Dívidas'),600);}
  }finally{liberarBotao(btn);}
};
window.naoConseguiuPagar=async function(){const div=dividaAtual;div.emAtraso=true;div.valorAtrasado=(div.valorAtrasado||0)+div.parcela;if(!div.historicoPagamentos)div.historicoPagamentos=[];div.historicoPagamentos.push({tipo:'nao_pago',valor:0,data:new Date().toISOString()});await saveDivida2(div);fecharOverlay('overlay-pagamento');await renderDividas();const jurosExtra=div.parcela*(div.juros/100);toast('⚠️ Registrado. ~'+fmt(jurosExtra)+' em juros extras este mês.');};

window.abrirDividas=async function(){
  // Navega primeiro e mostra loading — as queries chegam depois (padrão abrirReserva)
  document.getElementById('dividas-resumo').innerHTML='';
  document.getElementById('dividas-lista').innerHTML='<div class="loading"><span class="spinner"></span>Carregando dívidas...</div>';
  ir('screen-dividas');
  try{await renderDividas();}catch(e){console.error(e);}
};

export { getDividas };
