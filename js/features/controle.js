/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/controle.js
 * Controle Financeiro: lançamentos (coleção 'controle'),
 * carteira mensal/anual, categorias customizáveis (persistidas
 * no doc do usuário).
 * Corpo movido verbatim do monólito.
 * ═══════════════════════════════════════════════════════════ */

import { db, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc, query, where, logEko } from '../core/firebase.js';
import { store, cache } from '../core/store.js';
import { ir } from '../core/router.js';
import { fmt, esc } from '../utils/format.js';
import { parseMoney } from '../utils/money.js';
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
      await updateDoc(doc(db,'controle',_id), data);
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

// Busca de lançamentos e importação de extrato — fora do escopo desta
// reestruturação (busca ainda não existe; importação será reintegrada
// na Parte 2, ver js/main.js). Placeholders para os botões não ficarem
// sem handler.
window.abrirBuscaCF = function() {
  toast('🔍 Busca em breve!');
};

window.abrirSheetImportacao = function() {
  toast('📥 Importação em breve!');
};

window.abrirControleFinanceiro = async function() {
  ir('screen-controle');
  await renderControleFinanceiro();
};

async function renderControleFinanceiro() {
  cfMesVis = new Date().getMonth();
  cfAnoVis = new Date().getFullYear();
  await renderDashboardControle();
}

function atualizarTipoBotoes(tipo) {
  const btnG = document.getElementById('cf-tipo-gasto');
  const btnR = document.getElementById('cf-tipo-entrada');
  if(!btnG || !btnR) return;
  if(tipo==='gasto') {
    btnG.style.cssText='flex:1;padding:.625rem;border-radius:10px;border:2px solid var(--red);background:var(--red-light);color:var(--red);font-weight:700;font-size:13px;cursor:pointer;transition:all .2s';
    btnR.style.cssText='flex:1;padding:.625rem;border-radius:10px;border:2px solid var(--border);background:var(--surface);color:var(--text-muted);font-weight:700;font-size:13px;cursor:pointer;transition:all .2s';
  } else {
    btnR.style.cssText='flex:1;padding:.625rem;border-radius:10px;border:2px solid var(--eko-green);background:var(--eko-green-light);color:var(--eko-green-dark);font-weight:700;font-size:13px;cursor:pointer;transition:all .2s';
    btnG.style.cssText='flex:1;padding:.625rem;border-radius:10px;border:2px solid var(--border);background:var(--surface);color:var(--text-muted);font-weight:700;font-size:13px;cursor:pointer;transition:all .2s';
  }
}

window.selecionarTipoLancamento = async function(tipo) {
  cfTipoAtual = tipo;
  cfCatSelecionada = null;
  cfCatsExpandido = false;
  atualizarTipoBotoes(tipo);
  await renderCategoriasBotoes();
};

let cfCatsExpandido = false; // colapsado: mostra só as 5 primeiras

async function renderCategoriasBotoes() {
  const cats = await getCFCategorias();
  const lista = (cats[cfTipoAtual] || []).filter(c => c.visivel);
  const grid = document.getElementById('cf-categorias-grid');
  if (!grid) return;

  let visiveis;
  if (cfCatsExpandido) {
    visiveis = lista;
  } else {
    // As 5 mais usadas (por frequência nos lançamentos já feitos do mesmo tipo)
    const lancs = await getCFLancamentos();
    const usoCount = {};
    lancs.filter(l => l.tipo === cfTipoAtual).forEach(l => { usoCount[l.categoria] = (usoCount[l.categoria]||0) + 1; });
    visiveis = [...lista].sort((a,b) => (usoCount[b.id]||0) - (usoCount[a.id]||0)).slice(0, 5);
    // Garante que a categoria já selecionada (modo edição) apareça mesmo se não estiver entre as mais usadas
    if (cfCatSelecionada && !visiveis.some(c => c.id === cfCatSelecionada)) {
      const sel = lista.find(c => c.id === cfCatSelecionada);
      if (sel) visiveis = [sel, ...visiveis.slice(0, 4)];
    }
  }

  const corBorda = cfTipoAtual==='gasto' ? 'var(--red)' : 'var(--eko-green)';
  const corFundo = cfTipoAtual==='gasto' ? 'var(--red-light)' : 'var(--eko-green-light)';
  const corTexto = cfTipoAtual==='gasto' ? 'var(--red)' : 'var(--eko-green-dark)';
  grid.innerHTML = visiveis.map(c => {
    const safeId = c.id.replace(/'/g,"\\'");
    const sel = c.id === cfCatSelecionada;
    return `<button onclick="selecionarCategoriaCF('${safeId}')" id="cfcat-${c.id}"
      style="padding:.5rem .25rem;border-radius:10px;border:2px solid ${sel?corBorda:'var(--border)'};background:${sel?corFundo:'var(--surface)'};font-size:11px;font-weight:700;cursor:pointer;transition:all .2s;line-height:1.4;color:${sel?corTexto:'var(--text)'}">
      ${c.nome}
    </button>`;
  }).join('');
  if (!cfCatsExpandido && lista.length > visiveis.length) {
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


// ════ SHEET DE LANÇAMENTO — DATA ════════════════════════════
let cfDataSelecionada = new Date(); // data do lançamento sendo criado/editado

function atualizarDataTexto() {
  const el = document.getElementById('cf-data-texto');
  if (!el) return;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
  const d = new Date(cfDataSelecionada); d.setHours(0,0,0,0);
  if (d.getTime() === hoje.getTime()) el.textContent = 'Hoje';
  else if (d.getTime() === ontem.getTime()) el.textContent = 'Ontem';
  else el.textContent = cfDataSelecionada.toLocaleDateString('pt-BR');
}

window.abrirDatePicker = function() {
  const custom = document.getElementById('cf-data-custom');
  if (!custom) return;
  custom.value = cfDataSelecionada.toISOString().slice(0,10);
  if (typeof custom.showPicker === 'function') {
    try { custom.showPicker(); } catch(e) { custom.focus(); }
  } else {
    custom.focus();
  }
};

window.onDataCustomChange = function() {
  const val = document.getElementById('cf-data-custom')?.value;
  if (!val) return;
  cfDataSelecionada = new Date(val + 'T12:00:00');
  atualizarDataTexto();
};

// ════ SHEET DE LANÇAMENTO — abrir/fechar/salvar ═════════════
let cfLancamentoEditando = null; // lançamento em edição — null = criando novo

window.abrirSheetLancamento = async function(lancamento = null) {
  cfLancamentoEditando = lancamento;
  cfTipoAtual = lancamento ? lancamento.tipo : 'gasto';
  cfCatSelecionada = lancamento ? lancamento.categoria : null;
  cfCatsExpandido = false;
  cfDataSelecionada = lancamento ? new Date(lancamento.data || lancamento.criadoEm) : new Date();

  limparMsg('cf-msg');
  const tituloEl = document.getElementById('cf-sheet-titulo');
  if (tituloEl) tituloEl.textContent = lancamento ? 'Editar lançamento' : 'Novo lançamento';
  const valorEl = document.getElementById('cf-valor');
  if (valorEl) valorEl.value = lancamento ? lancamento.valor : '';

  atualizarTipoBotoes(cfTipoAtual);
  atualizarDataTexto();
  await renderCategoriasBotoes();

  abrirOverlay('sheet-lancamento');
  if (valorEl) setTimeout(() => valorEl.focus(), 200); // aguarda a animação do sheet subir
};

window.fecharSheetLancamento = function() {
  fecharOverlay('sheet-lancamento');
  cfLancamentoEditando = null;
};

window.salvarLancamento = async function() {
  const btn = btnDoClique(); if (btn) btn.disabled = true;
  try {
  limparMsg('cf-msg');
  const valor = parseMoney(document.getElementById('cf-valor').value);
  if (!valor || valor <= 0) { showMsg('cf-msg','error','Informe o valor.'); return; }
  if (!cfCatSelecionada) { showMsg('cf-msg','error','Selecione uma categoria.'); return; }
  const editando = cfLancamentoEditando;
  const lanc = {
    tipo: cfTipoAtual,
    valor,
    categoria: cfCatSelecionada,
    mes: cfDataSelecionada.getMonth(),
    ano: cfDataSelecionada.getFullYear(),
    chaveMes: cfChaveMes(cfDataSelecionada.getFullYear(), cfDataSelecionada.getMonth()),
    data: cfDataSelecionada.toISOString(),
  };
  if (editando) lanc._id = editando._id;
  try {
    await saveCFLancamento(lanc);
  } catch(e) {
    showMsg('cf-msg','error','Erro ao salvar. Verifique sua conexão.');
    return;
  }
  logEko('cf_lancamento', {tipo: cfTipoAtual, categoria: cfCatSelecionada, edicao: !!editando});
  toast('✅ Lançamento registrado', 'sucesso');
  fecharSheetLancamento();
  await renderDashboardControle();
  await renderHubControle();
  } finally { liberarBotao(btn); }
};

// Gesto de arrastar para fechar — arrasta o handle mais de 100px para
// baixo fecha o sheet; abaixo disso, volta pra posição original.
(function initGestoFecharSheetLancamento() {
  const wrap = document.getElementById('sheet-lancamento');
  const handle = wrap && wrap.querySelector('.sheet-handle');
  const sheet  = wrap && wrap.querySelector('.sheet');
  if (!handle || !sheet) return;
  let startY = null;

  handle.addEventListener('touchstart', e => {
    startY = e.touches[0].clientY;
    sheet.style.transition = 'none';
  }, {passive:true});

  handle.addEventListener('touchmove', e => {
    if (startY === null) return;
    const delta = e.touches[0].clientY - startY;
    if (delta > 0) sheet.style.transform = `translateY(${delta}px)`;
  }, {passive:true});

  handle.addEventListener('touchend', e => {
    if (startY === null) return;
    const delta = e.changedTouches[0].clientY - startY;
    sheet.style.transition = 'transform .2s';
    sheet.style.transform = '';
    if (delta > 100) fecharSheetLancamento();
    startY = null;
  }, {passive:true});
})();

// ── Dashboard (resumo do mês, categorias, recentes, importações) ─
window.navegarMesControle = async function(dir) {
  cfMesVis += dir;
  if (cfMesVis < 0) { cfMesVis = 11; cfAnoVis--; }
  if (cfMesVis > 11) { cfMesVis = 0; cfAnoVis++; }
  await renderDashboardControle();
};

async function renderDashboardControle() {
  const lancs = await getCFLancamentos();
  const cats  = await getCFCategorias();
  const chave = cfChaveMes(cfAnoVis, cfMesVis);
  const doMes = lancs.filter(l => l.chaveMes === chave);

  const mesEl = document.getElementById('cf-mes-label');
  if (mesEl) mesEl.textContent = cfNomeMes(cfMesVis, cfAnoVis).replace(/^\w/, c => c.toUpperCase());

  const totalRec  = doMes.filter(l=>l.tipo==='receita').reduce((s,l)=>s+l.valor,0);
  const totalGast = doMes.filter(l=>l.tipo==='gasto').reduce((s,l)=>s+l.valor,0);
  const saldo = totalRec - totalGast;
  const elEnt = document.getElementById('cf-total-entradas');
  const elSai = document.getElementById('cf-total-saidas');
  const elSal = document.getElementById('cf-saldo-mes');
  if (elEnt) elEnt.textContent = fmt(totalRec);
  if (elSai) elSai.textContent = fmt(totalGast);
  if (elSal) { elSal.textContent = fmt(saldo); elSal.className = saldo >= 0 ? 'verde' : 'vermelho'; }

  renderCategoriasMes(doMes, cats, totalRec, totalGast);
  await renderLancamentosRecentes(doMes, cats);
  renderImportacoesSection();
}

function renderCategoriasMes(doMes, cats, totalRec, totalGast) {
  const el = document.getElementById('cf-categorias-mes');
  if (!el) return;
  if (!doMes.length) {
    el.innerHTML = `<div class="empty-state">📭 Nenhum lançamento em ${cfNomeMes(cfMesVis,cfAnoVis)}</div>`;
    return;
  }
  const todasCats = [...(cats.gasto||[]), ...(cats.receita||[])];
  const porCat = {};
  doMes.forEach(l => { porCat[l.categoria] = (porCat[l.categoria]||0) + l.valor; });

  const itens = Object.entries(porCat).sort((a,b)=>b[1]-a[1]).map(([id,val]) => {
    const cat = todasCats.find(c=>c.id===id);
    const nome = cat ? cat.nome : id;
    const isReceita = (cats.receita||[]).some(c=>c.id===id);
    const base = isReceita ? totalRec : totalGast;
    const pct = base > 0 ? Math.round((val/base)*100) : 0;
    return `<div data-catid="${id}" class="cf-cat-item" style="padding:.625rem 0;border-bottom:1px solid var(--border);cursor:pointer">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;pointer-events:none">
        <div style="font-size:13px;font-weight:600">${esc(nome)}</div>
        <div style="font-size:13px;font-weight:800;color:${isReceita?'var(--eko-green)':'var(--red)'}">${isReceita?'+':'-'}${fmt(val)} · ${pct}%</div>
      </div>
      <div class="prog-bg" style="height:6px;pointer-events:none">
        <div class="prog-fill" style="width:${pct}%;background:${isReceita?'linear-gradient(90deg,var(--eko-green),#5DCAA5)':'linear-gradient(90deg,var(--red),#D65A5A)'}"></div>
      </div>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="card" id="cf-cat-container" style="padding:1rem 1.125rem">${itens}</div>`;

  const container = document.getElementById('cf-cat-container');
  if (container) {
    container.addEventListener('click', function(e) {
      const item = e.target.closest('.cf-cat-item');
      if (item) abrirLancamentosCat(item.dataset.catid);
    });
  }
}

async function renderLancamentosRecentes(doMes, cats) {
  const el = document.getElementById('cf-lancamentos-recentes');
  if (!el) return;
  if (!doMes.length) {
    el.innerHTML = '<div class="empty-state">Nenhum lançamento neste mês ainda</div>';
    return;
  }
  const todasCats = [...(cats.gasto||[]), ...(cats.receita||[])];
  const recentes = [...doMes].sort((a,b) => new Date(b.data||b.criadoEm) - new Date(a.data||a.criadoEm)).slice(0,5);
  const itens = recentes.map(l => {
    const data = new Date(l.data || l.criadoEm).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
    const isReceita = l.tipo === 'receita';
    const cat = todasCats.find(c => c.id === l.categoria);
    return `<div class="cf-recente-item" data-lancid="${l._id}" style="display:flex;align-items:center;justify-content:space-between;padding:.625rem 0;border-bottom:1px solid var(--border);cursor:pointer">
      <div style="pointer-events:none">
        <div style="font-size:13px;font-weight:600">${esc(cat ? cat.nome : l.categoria)}</div>
        <div style="font-size:11px;color:var(--text-muted)">${data}</div>
      </div>
      <div style="font-size:13px;font-weight:800;color:${isReceita?'var(--eko-green)':'var(--red)'};pointer-events:none">${isReceita?'+':'-'}${fmt(l.valor)}</div>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="card" id="cf-recentes-container" style="padding:1rem 1.125rem">
    ${itens}
    <button onclick="abrirTodosLancamentosCF()" class="link-btn" style="margin-top:.75rem;display:block;text-align:center;width:100%">Ver todos →</button>
  </div>`;

  const container = document.getElementById('cf-recentes-container');
  if (container) {
    container.addEventListener('click', function(e) {
      const item = e.target.closest('.cf-recente-item');
      if (!item) return;
      const lanc = recentes.find(l => l._id === item.dataset.lancid);
      if (lanc) abrirSheetLancamento(lanc);
    });
  }
}

// ── Importações (histórico local — leitura do localStorage) ──
const CF_IMPORTACOES_KEY = 'eko_importacoes';

function getImportacoesLocal() {
  try { return JSON.parse(localStorage.getItem(CF_IMPORTACOES_KEY)) || []; } catch(e) { return []; }
}

window.toggleImportacoes = function() {
  const lista = document.getElementById('cf-importacoes-lista');
  const chevron = document.getElementById('cf-importacoes-chevron');
  if (!lista) return;
  const aberto = lista.style.display !== 'none';
  lista.style.display = aberto ? 'none' : 'block';
  if (chevron) chevron.style.transform = aberto ? 'rotate(0deg)' : 'rotate(180deg)';
};

function renderImportacoesSection() {
  const el = document.getElementById('cf-importacoes-lista');
  if (!el) return;
  const historico = getImportacoesLocal().slice().sort((a,b) => new Date(b.importado_em) - new Date(a.importado_em));
  if (!historico.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:.5rem 0">Nenhuma importação realizada ainda.</div>';
    return;
  }
  el.innerHTML = historico.map(imp => {
    const data = imp.importado_em ? new Date(imp.importado_em).toLocaleDateString('pt-BR') : '';
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:.625rem 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:13px;font-weight:700">${esc(imp.fonte || 'Extrato')}</div>
        <div style="font-size:11px;color:var(--text-muted)">${imp.aprovadas ?? 0} lançamento(s) · ${data}</div>
      </div>
      <button onclick="desfazerImportacaoCF('${imp.id}')" style="background:none;border:none;color:var(--red);font-size:12px;font-weight:700;cursor:pointer">Desfazer</button>
    </div>`;
  }).join('');
}

// A reversão real depende do módulo de importação, que não está carregado
// nesta reestruturação (ver js/main.js) — fica pronta para religar quando
// o módulo for reintegrado.
window.desfazerImportacaoCF = function(id) {
  toast('↩️ Desfazer estará disponível quando a importação for reintegrada.');
};

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

// ── Lançamentos: lista por categoria e lista completa do mês ─
window.abrirLancamentosCat = async function(catId) {
  const lancs = await getCFLancamentos();
  const cats  = await getCFCategorias();
  const chave = cfChaveMes(cfAnoVis, cfMesVis);
  const todasCats = [...(cats.gasto||[]), ...(cats.receita||[])];
  const cat = todasCats.find(c=>c.id===catId);
  const isReceita = (cats.receita||[]).some(c=>c.id===catId);
  const doMesCat = lancs.filter(l=>l.chaveMes===chave && l.categoria===catId)
    .sort((a,b) => new Date(b.data||b.criadoEm) - new Date(a.data||a.criadoEm));
  const total = doMesCat.reduce((s,l)=>s+l.valor,0);

  const tituloEl = document.getElementById('cf-lanc-titulo');
  const subEl    = document.getElementById('cf-lanc-subtitulo');
  if(tituloEl) tituloEl.textContent = cat ? cat.nome : catId;
  if(subEl) subEl.textContent = `Total: ${isReceita?'+':'-'}${fmt(total)} · ${cfNomeMes(cfMesVis,cfAnoVis)}`;

  renderListaLancamentos(doMesCat, todasCats);
  abrirOverlay('overlay-cf-lancamentos');
};

window.abrirTodosLancamentosCF = async function() {
  const lancs = await getCFLancamentos();
  const cats  = await getCFCategorias();
  const chave = cfChaveMes(cfAnoVis, cfMesVis);
  const todasCats = [...(cats.gasto||[]), ...(cats.receita||[])];
  const doMes = lancs.filter(l=>l.chaveMes===chave)
    .sort((a,b) => new Date(b.data||b.criadoEm) - new Date(a.data||a.criadoEm));

  const tituloEl = document.getElementById('cf-lanc-titulo');
  const subEl    = document.getElementById('cf-lanc-subtitulo');
  if(tituloEl) tituloEl.textContent = 'Todos os lançamentos';
  if(subEl) subEl.textContent = cfNomeMes(cfMesVis,cfAnoVis).replace(/^\w/,c=>c.toUpperCase());

  renderListaLancamentos(doMes, todasCats);
  abrirOverlay('overlay-cf-lancamentos');
};

// Handler estável do container de lançamentos — guardado aqui para poder
// ser removido antes de cada re-render, evitando acumular um listener a
// cada abertura do overlay (o elemento é reaproveitado, só o innerHTML muda).
let _lancListaClickHandler = null;

function renderListaLancamentos(lancs, todasCats) {
  const el = document.getElementById('cf-lanc-lista');
  if(!el) return;
  if(!lancs.length) {
    el.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:14px">Nenhum lançamento.</div>';
    return;
  }
  el.innerHTML = lancs.map(l => {
    const data = new Date(l.data||l.criadoEm).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
    const isReceita = l.tipo === 'receita';
    const cat = todasCats.find(c=>c.id===l.categoria);
    return `<div class="cf-lanc-item" data-lancid="${l._id}" style="display:flex;align-items:center;justify-content:space-between;padding:.75rem 0;border-bottom:1px solid var(--border);cursor:pointer">
      <div style="pointer-events:none">
        <div style="font-size:14px;font-weight:700;color:${isReceita?'var(--eko-green)':'var(--red)'}">${isReceita?'+':'-'}${fmt(l.valor)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(cat ? cat.nome : l.categoria)} · ${data}</div>
      </div>
      <button data-del="${l._id}"
        style="background:var(--red-light);border:none;color:var(--red);border-radius:8px;padding:.4rem .75rem;font-size:13px;cursor:pointer;font-weight:700">
        🗑️
      </button>
    </div>`;
  }).join('');

  // Event delegation no container da lista — remove o listener da renderização
  // anterior antes de anexar um novo, para não acumular handlers
  if (_lancListaClickHandler) el.removeEventListener('click', _lancListaClickHandler);
  _lancListaClickHandler = async function(e) {
    const delBtn = e.target.closest('button[data-del]');
    if (delBtn) { await excluirLancamentoCF(delBtn.dataset.del); return; }
    const item = e.target.closest('.cf-lanc-item');
    if (item) {
      const lanc = lancs.find(l => l._id === item.dataset.lancid);
      if (lanc) { fecharOverlay('overlay-cf-lancamentos'); abrirSheetLancamento(lanc); }
    }
  };
  el.addEventListener('click', _lancListaClickHandler);
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
  toast('🗑️ Lançamento removido', 'sucesso');
  fecharOverlay('overlay-cf-lancamentos');
  await renderDashboardControle();
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
