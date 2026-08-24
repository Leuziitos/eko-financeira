/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/controle.js
 * Controle Financeiro: lançamentos (coleção 'controle'),
 * carteira mensal/anual, categorias customizáveis (persistidas
 * no doc do usuário).
 * Corpo movido verbatim do monólito.
 * ═══════════════════════════════════════════════════════════ */

import { db, doc, getDoc, setDoc, deleteDoc, collection, getDocs, addDoc, query, where, logEko } from '../core/firebase.js';
import { store, cache } from '../core/store.js';
import { ir } from '../core/router.js';
import { fmt, esc } from '../utils/format.js';
import { parseMoney, applyMoneyMask } from '../utils/money.js';
import { showMsg, limparMsg, toast, abrirOverlay, fecharOverlay, btnDoClique, liberarBotao } from '../utils/dom.js';

// ════════════════════════════════════════════════
// CONTROLE FINANCEIRO
// ════════════════════════════════════════════════

const CF_CATS_PADRAO = {
  gasto: [
    {id:'moradia',nome:'🏠 Moradia',visivel:true,padrao:true},
    {id:'alimentacao',nome:'🍔 Alimentação',visivel:true,padrao:true},
    {id:'transporte',nome:'🚗 Transporte',visivel:true,padrao:true},
    {id:'saude',nome:'💊 Saúde',visivel:true,padrao:true},
    {id:'educacao',nome:'📚 Educação',visivel:true,padrao:true},
    {id:'lazer',nome:'🎮 Lazer',visivel:true,padrao:true},
    {id:'compras',nome:'👗 Compras',visivel:true,padrao:true},
    {id:'beleza',nome:'💈 Beleza',visivel:true,padrao:true},
    {id:'viagem',nome:'✈️ Viagem',visivel:true,padrao:true},
    {id:'servicos',nome:'📱 Serviços',visivel:true,padrao:true},
    {id:'contas',nome:'💡 Contas fixas',visivel:true,padrao:true},
    {id:'impostos',nome:'🏛️ Impostos',visivel:true,padrao:true},
    {id:'empreendimento',nome:'💼 Negócio',visivel:true,padrao:true},
    {id:'metas',nome:'🎯 Metas',visivel:true,padrao:true},
    {id:'dividas',nome:'💳 Dívidas',visivel:true,padrao:true},
    {id:'outras',nome:'📦 Outras',visivel:true,padrao:true},
  ],
  receita: [
    {id:'salario',nome:'💼 Salário',visivel:true,padrao:true},
    {id:'renda-extra',nome:'💡 Renda extra',visivel:true,padrao:true},
    {id:'freelance',nome:'🖥️ Freelance',visivel:true,padrao:true},
    {id:'investimentos',nome:'📈 Investimentos',visivel:true,padrao:true},
    {id:'outros-rec',nome:'📦 Outros',visivel:true,padrao:true},
  ]
};

let cfTipoAtual = 'gasto';
let cfCatSelecionada = null;
let cfMesVis = new Date().getMonth(); // 0-11
let cfAnoVis = new Date().getFullYear();
let cfAddTipo = 'gasto'; // tipo selecionado no overlay de gerenciar

window.cfSetAddTipo = function(tipo) {
  cfAddTipo = tipo;
  const btnG = document.getElementById('cf-add-tipo-gasto');
  const btnR = document.getElementById('cf-add-tipo-receita');
  if(!btnG || !btnR) return;
  if(tipo==='gasto') {
    btnG.style.cssText='flex:1;padding:.4rem;border-radius:8px;border:2px solid var(--red);background:var(--red-light);color:var(--red);font-weight:700;font-size:12px;cursor:pointer';
    btnR.style.cssText='flex:1;padding:.4rem;border-radius:8px;border:2px solid var(--border);background:var(--surface);color:var(--text-muted);font-weight:700;font-size:12px;cursor:pointer';
  } else {
    btnR.style.cssText='flex:1;padding:.4rem;border-radius:8px;border:2px solid var(--eko-green);background:var(--eko-green-light);color:var(--eko-green-dark);font-weight:700;font-size:12px;cursor:pointer';
    btnG.style.cssText='flex:1;padding:.4rem;border-radius:8px;border:2px solid var(--border);background:var(--surface);color:var(--text-muted);font-weight:700;font-size:12px;cursor:pointer';
  }
};

async function getCFCategorias() {
  try {
    const snap = await getDoc(doc(db,'users',store.sessao.email));
    const data = snap.exists() ? snap.data() : {};
    if (data.cfCategorias) return data.cfCategorias;
  } catch(e){}
  // Primeira vez: salva as padrão no Firestore para persistir alterações futuras
  const padrao = JSON.parse(JSON.stringify(CF_CATS_PADRAO));
  try { await saveCFCategorias(padrao); } catch(e){}
  return padrao;
}

async function saveCFCategorias(cats) {
  try { await setDoc(doc(db,'users',store.sessao.email), {cfCategorias: cats}, {merge:true}); } catch(e){}
}

async function getCFLancamentos() {
  if (cache.controle) return cache.controle;
  try {
    const q = query(collection(db,'controle'), where('email','==',store.sessao.email));
    const snap = await getDocs(q);
    const r = [];
    snap.forEach(d => r.push({...d.data(), _id:d.id}));
    cache.controle = r.filter(l => !l.excluido);
    return cache.controle;
  } catch(e) { return []; }
}

async function saveCFLancamento(lanc) {
  try {
    const {_id, ...data} = lanc;
    if (_id) {
      await setDoc(doc(db,'controle',_id), data);
    } else {
      data.email = store.sessao.email;
      data.criadoEm = new Date().toISOString();
      const ref = await addDoc(collection(db,'controle'), data);
      lanc._id = ref.id;
    }
    cache.invalidar('controle');
  } catch(e) {
    console.error('saveCFLancamento:', e);
    throw e; // repropaga para o chamador mostrar erro ao usuário
  }
}

function cfChaveMes(ano, mes) {
  return `${ano}-${String(mes+1).padStart(2,'0')}`;
}

function cfNomeMes(mes, ano) {
  return new Date(ano, mes, 1).toLocaleDateString('pt-BR', {month:'long', year:'numeric'});
}

window.abrirControleFinanceiro = async function() {
  // Navega primeiro e mostra loading — as queries chegam depois (padrão abrirReserva)
  const grid = document.getElementById('cf-categorias-grid');
  if (grid) grid.innerHTML = '<div class="loading" style="grid-column:1/-1;padding:1rem"><span class="spinner"></span>Carregando...</div>';
  ir('screen-controle');
  await renderControleFinanceiro();
};

async function renderControleFinanceiro() {
  cfTipoAtual = 'gasto';
  cfCatSelecionada = null;
  cfCatsExpandido = false;
  cfMesVis = new Date().getMonth();
  cfAnoVis = new Date().getFullYear();
  selecionarDataLancamento('hoje');
  await renderCategoriasBotoes();
  // Boas-vindas se não tiver lançamentos ainda + saldo do topo
  // (reusa os lançamentos já buscados — sem query extra)
  try {
    const lancs = await getCFLancamentos();
    const bv = document.getElementById('cf-boas-vindas');
    if (bv) bv.style.display = lancs.length === 0 ? 'block' : 'none';
    const now = new Date();
    const chaveAtual = cfChaveMes(now.getFullYear(), now.getMonth());
    const doMesAtual = lancs.filter(l => l.chaveMes === chaveAtual);
    renderSaldoTopo(
      doMesAtual.filter(l => l.tipo === 'receita').reduce((s,l) => s + l.valor, 0),
      doMesAtual.filter(l => l.tipo === 'gasto').reduce((s,l) => s + l.valor, 0)
    );
  } catch(e){}
  // Limpa valor
  const vEl = document.getElementById('cf-valor');
  if(vEl) { vEl.value = ''; vEl.oninput = function(){ applyMoneyMask(this); }; }
}

window.selecionarTipoLancamento = async function(tipo) {
  cfTipoAtual = tipo;
  cfCatSelecionada = null;
  cfCatsExpandido = false;
  const btnG = document.getElementById('tipo-btn-gasto');
  const btnR = document.getElementById('tipo-btn-receita');
  if(tipo==='gasto') {
    btnG.style.cssText='flex:1;padding:.625rem;border-radius:10px;border:2px solid var(--red);background:var(--red-light);color:var(--red);font-weight:700;font-size:13px;cursor:pointer;transition:all .2s';
    btnR.style.cssText='flex:1;padding:.625rem;border-radius:10px;border:2px solid var(--border);background:var(--surface);color:var(--text-muted);font-weight:700;font-size:13px;cursor:pointer;transition:all .2s';
  } else {
    btnR.style.cssText='flex:1;padding:.625rem;border-radius:10px;border:2px solid var(--eko-green);background:var(--eko-green-light);color:var(--eko-green-dark);font-weight:700;font-size:13px;cursor:pointer;transition:all .2s';
    btnG.style.cssText='flex:1;padding:.625rem;border-radius:10px;border:2px solid var(--border);background:var(--surface);color:var(--text-muted);font-weight:700;font-size:13px;cursor:pointer;transition:all .2s';
  }
  await renderCategoriasBotoes();
};

let cfCatsExpandido = false; // colapsado: mostra só as 5 primeiras

async function renderCategoriasBotoes() {
  const cats = await getCFCategorias();
  const lista = (cats[cfTipoAtual] || []).filter(c => c.visivel);
  const grid = document.getElementById('cf-categorias-grid');
  if (!grid) return;
  const visiveis = cfCatsExpandido ? lista : lista.slice(0, 5);
  grid.innerHTML = visiveis.map(c => {
    const safeId = c.id.replace(/'/g,"\\'");
    return `<button onclick="selecionarCategoriaCF('${safeId}')" id="cfcat-${c.id}"
      style="padding:.5rem .25rem;border-radius:10px;border:2px solid var(--border);background:var(--surface);font-size:11px;font-weight:700;cursor:pointer;transition:all .2s;line-height:1.4;color:var(--text)">
      ${c.nome}
    </button>`;
  }).join('');
  if (!cfCatsExpandido && lista.length > 5) {
    grid.innerHTML += `<button onclick="expandirCategoriasCF()"
      style="padding:.5rem .25rem;border-radius:10px;border:2px dashed var(--border-strong);background:var(--surface2);font-size:11px;font-weight:700;cursor:pointer;transition:all .2s;line-height:1.4;color:var(--eko-green)">
      + Ver todas (${lista.length})
    </button>`;
  }
}

window.expandirCategoriasCF = function() {
  cfCatsExpandido = true;
  renderCategoriasBotoes();
};

window.selecionarCategoriaCF = function(id) {
  cfCatSelecionada = id;
  document.querySelectorAll('#cf-categorias-grid button').forEach(b => {
    b.style.border = '2px solid var(--border)';
    b.style.background = 'var(--surface)';
    b.style.color = 'var(--text)';
  });
  const btn = document.getElementById('cfcat-'+id);
  if(btn) {
    btn.style.border = cfTipoAtual==='gasto' ? '2px solid var(--red)' : '2px solid var(--eko-green)';
    btn.style.background = cfTipoAtual==='gasto' ? 'var(--red-light)' : 'var(--eko-green-light)';
    btn.style.color = cfTipoAtual==='gasto' ? 'var(--red)' : 'var(--eko-green-dark)';
  }
};


// ════ CONTROLE FINANCEIRO — DATA RETROATIVA ════════════════
let cfDataSelecionada = 'hoje'; // 'hoje' | 'ontem' | 'outro'

window.selecionarDataLancamento = function(opcao) {
  cfDataSelecionada = opcao;
  ['hoje','ontem','outro'].forEach(op => {
    const btn = document.getElementById('cf-data-' + op);
    if (!btn) return;
    const sel = op === opcao;
    btn.style.borderColor = sel ? 'var(--eko-green)' : 'var(--border)';
    btn.style.background = sel ? 'var(--eko-green-light)' : 'var(--surface)';
    btn.style.color = sel ? 'var(--eko-green-dark)' : 'var(--text-muted)';
  });
  const custom = document.getElementById('cf-data-custom');
  if (custom) custom.style.display = opcao === 'outro' ? '' : 'none';
  if (opcao === 'outro' && custom) {
    // Abre o calendário nativo imediatamente ao selecionar "Outra data"
    // (mantém a correção do bug do seletor — sem isso o campo só ficava
    // visível, exigindo um segundo toque para o calendário abrir).
    if (typeof custom.showPicker === 'function') {
      try { custom.showPicker(); } catch(e) { custom.focus(); }
    } else {
      custom.focus();
    }
  }
};

function getDataLancamento() {
  if (cfDataSelecionada === 'hoje') return new Date();
  if (cfDataSelecionada === 'ontem') {
    const d = new Date(); d.setDate(d.getDate() - 1); return d;
  }
  // outro
  const val = document.getElementById('cf-data-custom')?.value;
  if (val) return new Date(val + 'T12:00:00');
  return new Date();
}

window.salvarLancamento = async function() {
  const btn = btnDoClique(); if (btn) btn.disabled = true;
  try {
  limparMsg('cf-msg');
  const valor = parseMoney(document.getElementById('cf-valor').value);
  if (!valor || valor <= 0) { showMsg('cf-msg','error','Informe o valor.'); return; }
  if (!cfCatSelecionada) { showMsg('cf-msg','error','Selecione uma categoria.'); return; }
  const dataLanc = getDataLancamento();
  const lanc = {
    tipo: cfTipoAtual,
    valor,
    categoria: cfCatSelecionada,
    mes: dataLanc.getMonth(),
    ano: dataLanc.getFullYear(),
    chaveMes: cfChaveMes(dataLanc.getFullYear(), dataLanc.getMonth()),
    data: dataLanc.toISOString(),
  };
  try {
    await saveCFLancamento(lanc);
  } catch(e) {
    showMsg('cf-msg','error','Erro ao salvar. Verifique sua conexão.');
    return;
  }
  logEko('cf_lancamento', {tipo: cfTipoAtual, categoria: cfCatSelecionada});
  toast(cfTipoAtual==='gasto' ? '💸 Gasto registrado!' : '💵 Entrada registrada!');
  document.getElementById('cf-valor').value = '';
  cfCatSelecionada = null;
  cfCatsExpandido = false; // expansão reseta ao salvar
  await renderCategoriasBotoes();
  const bv = document.getElementById('cf-boas-vindas');
  if(bv) bv.style.display = 'none';
  // Resetar data para hoje
  selecionarDataLancamento('hoje');
  await renderHubControle();
  } finally { liberarBotao(btn); }
};

// ── Saldo do topo (Entradas / Saídas / Saldo do mês visível) ─
function renderSaldoTopo(totalRec, totalGast) {
  const e = document.getElementById('cf-topo-entradas');
  const s = document.getElementById('cf-topo-saidas');
  const sd = document.getElementById('cf-topo-saldo');
  if (!e || !s || !sd) return;
  const saldo = totalRec - totalGast;
  e.textContent = fmt(totalRec);
  s.textContent = fmt(totalGast);
  sd.textContent = fmt(saldo);
  sd.style.color = saldo >= 0 ? 'var(--eko-green)' : 'var(--red)';
}

// ── Carteira ─────────────────────────────────────────────────
window.navegarMesControle = async function(dir) {
  cfMesVis += dir;
  if (cfMesVis < 0) { cfMesVis = 11; cfAnoVis--; }
  if (cfMesVis > 11) { cfMesVis = 0; cfAnoVis++; }
  await renderCarteiraControle();
};

async function renderCarteiraControle() {
  const lancs = await getCFLancamentos();
  const cats  = await getCFCategorias();
  const chave = cfChaveMes(cfAnoVis, cfMesVis);

  // Labels
  const mesEl = document.getElementById('cf-mes-label');
  const anoEl = document.getElementById('cf-ano-label');
  const anoResEl = document.getElementById('cf-ano-resumo');
  if(mesEl) mesEl.textContent = new Date(cfAnoVis, cfMesVis, 1).toLocaleDateString('pt-BR',{month:'long'}).replace(/^\w/,c=>c.toUpperCase());
  if(anoEl) anoEl.textContent = cfAnoVis;
  if(anoResEl) anoResEl.textContent = cfAnoVis;

  // Lançamentos do mês
  const doMes = lancs.filter(l => l.chaveMes === chave);
  const totalRec  = doMes.filter(l=>l.tipo==='receita').reduce((s,l)=>s+l.valor,0);
  const totalGast = doMes.filter(l=>l.tipo==='gasto').reduce((s,l)=>s+l.valor,0);
  const saldo = totalRec - totalGast;

  // Saldo do topo acompanha o mês visível (dados já calculados — sem query extra)
  renderSaldoTopo(totalRec, totalGast);

  // Saldo acumulado total — soma de TODOS os lançamentos do usuário,
  // independente do mês navegado (usa lancs inteiro, não doMes; sem query extra)
  const totalRecAcumulado  = lancs.filter(l=>l.tipo==='receita').reduce((s,l)=>s+l.valor,0);
  const totalGastAcumulado = lancs.filter(l=>l.tipo==='gasto').reduce((s,l)=>s+l.valor,0);
  const saldoAcumulado = totalRecAcumulado - totalGastAcumulado;
  const elSaldoAcum = document.getElementById('cf-saldo-acumulado-valor');
  if (elSaldoAcum) {
    elSaldoAcum.textContent = fmt(saldoAcumulado);
    elSaldoAcum.style.color = saldoAcumulado >= 0 ? 'var(--eko-green)' : 'var(--red)';
  }

  // Resumo do mês
  const resumoEl = document.getElementById('cf-resumo-mes');
  if(resumoEl) resumoEl.innerHTML = `
    <div class="stat-card" style="text-align:center;padding:.75rem .5rem">
      <div class="slabel">Entradas</div>
      <div style="font-size:13px;font-weight:800;color:var(--eko-green)">${fmt(totalRec)}</div>
    </div>
    <div class="stat-card" style="text-align:center;padding:.75rem .5rem">
      <div class="slabel">Gastos</div>
      <div style="font-size:13px;font-weight:800;color:var(--red)">${fmt(totalGast)}</div>
    </div>
    <div class="stat-card" style="text-align:center;padding:.75rem .5rem">
      <div class="slabel">Saldo</div>
      <div style="font-size:13px;font-weight:800;color:${saldo>=0?'var(--eko-green)':'var(--red)'}">${fmt(saldo)}</div>
    </div>`;

  // Por categoria
  const catEl = document.getElementById('cf-categorias-mes');
  if(catEl) {
    const todasCats = [...(cats.gasto||[]), ...(cats.receita||[])];
    const porCat = {};
    doMes.forEach(l => {
      porCat[l.categoria] = (porCat[l.categoria]||0) + l.valor;
    });
    if(Object.keys(porCat).length === 0) {
      catEl.innerHTML = `<div class="card" style="text-align:center;padding:2rem;color:var(--text-muted)"><div style="font-size:32px;margin-bottom:.5rem">📭</div><div style="font-size:14px">Nenhum lançamento em ${cfNomeMes(cfMesVis,cfAnoVis)}</div></div>`;
    } else {
      const itens = Object.entries(porCat).sort((a,b)=>b[1]-a[1]).map(([id,val])=>{
        const cat = todasCats.find(c=>c.id===id);
        const nome = cat ? cat.nome : id;
        const isReceita = (cats.receita||[]).some(c=>c.id===id);
        return `<div data-catid="${id}" class="cf-cat-item" style="display:flex;align-items:center;justify-content:space-between;padding:.625rem 0;border-bottom:1px solid var(--border);cursor:pointer">
          <div style="font-size:14px;font-weight:600;pointer-events:none">${esc(nome)}</div>
          <div style="display:flex;align-items:center;gap:8px;pointer-events:none">
            <div style="font-size:14px;font-weight:800;color:${isReceita?'var(--eko-green)':'var(--red)'}">${isReceita?'+':'-'}${fmt(val)}</div>
            <div style="font-size:11px;color:var(--text-muted)">›</div>
          </div>
        </div>`;
      }).join('');
      catEl.innerHTML = `<div class="card" id="cf-cat-container"><div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.25rem">Por categoria <span style="font-weight:400;text-transform:none;letter-spacing:0">· toque para ver lançamentos</span></div>${itens}</div>`;

      // Event delegation — um único listener no container
      const container = document.getElementById('cf-cat-container');
      if(container) {
        container.addEventListener('click', function(e) {
          const item = e.target.closest('.cf-cat-item');
          if(item) abrirLancamentosCat(item.dataset.catid);
        });
      }
    }
  }

  // Resumo anual
  renderResumoAnualControle(lancs);
}

function renderResumoAnualControle(lancs) {
  const el = document.getElementById('cf-resumo-anual');
  if(!el) return;
  const doAno = lancs.filter(l=>l.ano===cfAnoVis);
  if(!doAno.length) { el.innerHTML='<div style="font-size:13px;color:var(--text-muted)">Nenhum lançamento em '+cfAnoVis+'</div>'; return; }
  const meses = Array.from({length:12},(_,i)=>i);
  const linhas = meses.map(m=>{
    const chave = cfChaveMes(cfAnoVis,m);
    const doMes = doAno.filter(l=>l.chaveMes===chave);
    if(!doMes.length) return null;
    const rec  = doMes.filter(l=>l.tipo==='receita').reduce((s,l)=>s+l.valor,0);
    const gast = doMes.filter(l=>l.tipo==='gasto').reduce((s,l)=>s+l.valor,0);
    const saldo = rec-gast;
    const nomeMes = new Date(cfAnoVis,m,1).toLocaleDateString('pt-BR',{month:'short'}).replace('.','').replace(/^\w/,c=>c.toUpperCase());
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid var(--border);font-size:12px">
      <div style="font-weight:700;min-width:28px">${nomeMes}</div>
      <div style="color:var(--eko-green);text-align:right;flex:1">${fmt(rec)}</div>
      <div style="color:var(--red);text-align:right;flex:1">${fmt(gast)}</div>
      <div style="font-weight:800;text-align:right;flex:1;color:${saldo>=0?'var(--eko-green)':'var(--red)'}">${fmt(saldo)}</div>
    </div>`;
  }).filter(Boolean);
  const totalRec  = doAno.filter(l=>l.tipo==='receita').reduce((s,l)=>s+l.valor,0);
  const totalGast = doAno.filter(l=>l.tipo==='gasto').reduce((s,l)=>s+l.valor,0);
  const saldoTotal = totalRec-totalGast;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:700;color:var(--text-muted);padding-bottom:.375rem;border-bottom:1px solid var(--border);margin-bottom:.125rem">
      <span style="min-width:28px">MÊS</span><span style="color:var(--eko-green);text-align:right;flex:1">ENT.</span><span style="color:var(--red);text-align:right;flex:1">GASTO</span><span style="text-align:right;flex:1">SALDO</span>
    </div>
    ${linhas.join('')}
    <div style="display:flex;align-items:center;justify-content:space-between;padding:.625rem 0;font-size:12px;font-weight:800;margin-top:.25rem;border-top:1px solid var(--border)">
      <div style="min-width:28px">Total</div>
      <div style="color:var(--eko-green);text-align:right;flex:1">${fmt(totalRec)}</div>
      <div style="color:var(--red);text-align:right;flex:1">${fmt(totalGast)}</div>
      <div style="text-align:right;flex:1;color:${saldoTotal>=0?'var(--eko-green)':'var(--red)'}">${fmt(saldoTotal)}</div>
    </div>`;
}

// ── Gerenciar categorias ──────────────────────────────────────
window.abrirGerenciarCategorias = async function() {
  // Sempre reseta para 'gasto' ao abrir, mantendo consistência visual
  cfAddTipo = 'gasto';
  await renderListaCategorias();
  abrirOverlay('overlay-cf-categorias');
  // Sincroniza visual dos botões após o overlay estar visível
  cfSetAddTipo('gasto');
};

async function renderListaCategorias() {
  const cats = await getCFCategorias();
  ['gasto','receita'].forEach(tipo => {
    const el = document.getElementById('cf-lista-cats-'+tipo);
    if(!el) return;
    el.innerHTML = (cats[tipo]||[]).map(c=>{
      const safeId = c.id.replace(/'/g,"\\'");
      const safeTipo = tipo.replace(/'/g,"\\'");
      return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid var(--border)">
        <div style="font-size:14px;font-weight:600">${c.nome}</div>
        <div style="display:flex;gap:8px;align-items:center">
          <button onclick="toggleCategoria('${safeTipo}','${safeId}')"
            style="font-size:12px;font-weight:700;padding:3px 10px;border-radius:99px;border:1px solid var(--border);background:${c.visivel?'var(--eko-green-light)':'var(--surface)'};color:${c.visivel?'var(--eko-green-dark)':'var(--text-muted)'};cursor:pointer">
            ${c.visivel?'Visível':'Oculta'}
          </button>
          ${!c.padrao?`<button onclick="removerCategoria('${safeTipo}','${safeId}')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:15px">🗑️</button>`:''}
        </div>
      </div>`;
    }).join('');
  });
}

window.toggleCategoria = async function(tipo, id) {
  const cats = await getCFCategorias();
  const cat = (cats[tipo]||[]).find(c=>c.id===id);
  if(cat) cat.visivel = !cat.visivel;
  await saveCFCategorias(cats);
  await renderListaCategorias();
  await renderCategoriasBotoes();
};

window.removerCategoria = async function(tipo, id) {
  if(!confirm('Remover esta categoria?')) return;
  const cats = await getCFCategorias();
  cats[tipo] = (cats[tipo]||[]).filter(c=>c.id!==id);
  await saveCFCategorias(cats);
  await renderListaCategorias();
  await renderCategoriasBotoes();
};

window.adicionarCategoria = async function() {
  const nomeEl = document.getElementById('cf-nova-cat-nome');
  const nome = nomeEl.value.trim();
  if(!nome) { toast('Digite o nome da categoria.'); return; }
  const cats = await getCFCategorias();
  const tipo = cfAddTipo;
  const id = 'custom-'+Date.now();
  (cats[tipo]||[]).push({id, nome, visivel:true, padrao:false});
  await saveCFCategorias(cats);
  nomeEl.value = '';
  await renderListaCategorias();
  await renderCategoriasBotoes();
  toast('✅ Categoria adicionada em ' + (tipo==='gasto'?'Gastos':'Entradas') + '!');
};

// ── Lançamentos por categoria (excluir) ──────────────────────
window.abrirLancamentosCat = async function(catId) {
  const lancs = await getCFLancamentos();
  const cats  = await getCFCategorias();
  const chave = cfChaveMes(cfAnoVis, cfMesVis);
  const todasCats = [...(cats.gasto||[]), ...(cats.receita||[])];
  const cat = todasCats.find(c=>c.id===catId);
  const isReceita = (cats.receita||[]).some(c=>c.id===catId);
  const doMesCat = lancs.filter(l=>l.chaveMes===chave && l.categoria===catId);
  const total = doMesCat.reduce((s,l)=>s+l.valor,0);

  const tituloEl = document.getElementById('cf-lanc-titulo');
  const subEl    = document.getElementById('cf-lanc-subtitulo');
  if(tituloEl) tituloEl.textContent = cat ? cat.nome : catId;
  if(subEl) subEl.textContent = `Total: ${isReceita?'+':'-'}${fmt(total)} · ${cfNomeMes(cfMesVis,cfAnoVis)}`;

  renderLancamentosCat(doMesCat, isReceita);
  abrirOverlay('overlay-cf-lancamentos');
};

// Handler estável do container de lançamentos por categoria — guardado aqui
// para poder ser removido antes de cada re-render, evitando acumular um
// listener a cada abertura do overlay (o elemento é reaproveitado, só o
// innerHTML muda).
let _lancCatClickHandler = null;

function renderLancamentosCat(lancs, isReceita) {
  const el = document.getElementById('cf-lanc-lista');
  if(!el) return;
  if(!lancs.length) {
    el.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:14px">Nenhum lançamento nesta categoria.</div>';
    return;
  }
  el.innerHTML = lancs.map((l,i) => {
    const data = new Date(l.criadoEm).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:14px;font-weight:700;color:${isReceita?'var(--eko-green)':'var(--red)'}">${isReceita?'+':'-'}${fmt(l.valor)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${data}</div>
      </div>
      <button data-lancid="${l._id}"
        style="background:var(--red-light);border:none;color:var(--red);border-radius:8px;padding:.4rem .75rem;font-size:13px;cursor:pointer;font-weight:700">
        🗑️ Excluir
      </button>
    </div>`;
  }).join('');

  // Event delegation no container da lista — remove o listener da renderização
  // anterior antes de anexar um novo, para não acumular handlers
  if (_lancCatClickHandler) el.removeEventListener('click', _lancCatClickHandler);
  _lancCatClickHandler = async function(e) {
    const btn = e.target.closest('button[data-lancid]');
    if(!btn) return;
    await excluirLancamentoCF(btn.dataset.lancid);
  };
  el.addEventListener('click', _lancCatClickHandler);
}

window.excluirLancamentoCF = async function(id) {
  if(!confirm('Excluir este lançamento?')) return;
  try {
    await deleteDoc(doc(db,'controle',id));
  } catch(e) {
    // fallback: marca como excluído
    try {
      await setDoc(doc(db,'controle',id), {excluido:true}, {merge:true});
    } catch(e2) {
      toast('Erro ao excluir. Tente novamente.');
      return;
    }
  }
  cache.invalidar('controle');
  toast('🗑️ Lançamento excluído!');
  fecharOverlay('overlay-cf-lancamentos');
  await renderCarteiraControle();
  await renderHubControle();
};
async function renderHubControle() {
  try {
    const lancs = await getCFLancamentos();
    const now = new Date();
    const chave = cfChaveMes(now.getFullYear(), now.getMonth());
    const doMes = lancs.filter(l=>l.chaveMes===chave);
    const totalRec  = doMes.filter(l=>l.tipo==='receita').reduce((s,l)=>s+l.valor,0);
    const totalGast = doMes.filter(l=>l.tipo==='gasto').reduce((s,l)=>s+l.valor,0);
    const saldo = totalRec-totalGast;
    // Mantém o saldo do topo em sincronia após saves — só quando o mês
    // visível é o atual, para não sobrescrever a navegação do Histórico
    if (cfMesVis === now.getMonth() && cfAnoVis === now.getFullYear()) renderSaldoTopo(totalRec, totalGast);
    const sub = document.getElementById('hub-controle-sub');
    if(!sub) return;
    if(!doMes.length) {
      sub.innerHTML = '<span style="color:var(--amber)">Nenhum lançamento ainda</span>';
    } else {
      sub.innerHTML = `Saldo: <strong style="color:${saldo>=0?'var(--eko-green)':'var(--red)'}">${fmt(saldo)}</strong>`;
    }
  } catch(e){}
}

// ── Integração: registrar gasto ao pagar dívida/meta ─────────
async function cfSugerirLancamento(tipo, valor, categoriaId, categoriaNome) {
  const ok = confirm(`💡 Deseja registrar ${fmt(valor)} como ${tipo==='gasto'?'gasto':'entrada'} em "${categoriaNome}" no Controle Financeiro?`);
  if(!ok) return;
  const now = new Date();
  await saveCFLancamento({
    tipo, valor,
    categoria: categoriaId,
    mes: now.getMonth(),
    ano: now.getFullYear(),
    chaveMes: cfChaveMes(now.getFullYear(), now.getMonth()),
  });
  toast('✅ Registrado no Controle Financeiro!');
  await renderHubControle();
}

export { getCFLancamentos, getCFCategorias, saveCFCategorias, cfChaveMes, renderHubControle, cfSugerirLancamento };
