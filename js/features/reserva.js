/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/reserva.js
 * Reserva de Emergência: onboarding educativo em 3 passos,
 * configuração (perfil/meses/onde guardar), painel com marcos,
 * aportes e usos (doc 'reserva/<email>'), e conversão em meta
 * financeira (via saveMeta2 de metas.js).
 * Corpo movido verbatim do monólito.
 * ═══════════════════════════════════════════════════════════ */

import { db, doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where, logEko } from '../core/firebase.js';
import { store } from '../core/store.js';
import { ir } from '../core/router.js';
import { fmt, fmtInput, esc } from '../utils/format.js';
import { parseMoney } from '../utils/money.js';
import { toast, abrirOverlay, fecharOverlay } from '../utils/dom.js';
import { saveMeta2 } from './metas.js';

// ════ RESERVA DE EMERGÊNCIA ════════════════════════════════
let reservaConfig = null;
let reservaPerfilSelecionado = 'clt';
let reservaFonteSelecionada = 'manual';
const TAXAS_RENDIMENTO = {
  'Tesouro Selic': 0.1065,
  'CDB 100% CDI': 0.1065,
  'Poupança': 0.07
};

const ONDE_GUARDAR_OPCOES = [
  { id: 'tesouro', label: '🟢 Tesouro Selic', desc: 'Melhor opção — seguro e rende ~CDI' },
  { id: 'cdb', label: '🟡 CDB 100% CDI', desc: 'Seguro pelo FGC até R$250k' },
  { id: 'poupanca', label: '🔴 Poupança', desc: 'Menos rentável, mas segura' },
];

window.abrirReserva = async function() {
  ir('screen-reserva');
  const ref = doc(db, 'reserva', store.sessao.email);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    reservaConfig = snap.data();
    mostrarPainelReserva();
  } else {
    reservaConfig = null;
    mostrarOnboardingReserva();
  }
  atualizarHubReserva();
};

function mostrarOnboardingReserva() {
  document.getElementById('reserva-onboarding').style.display = 'block';
  document.getElementById('reserva-painel').style.display = 'none';
  reservaStep(1);
}

function mostrarPainelReserva() {
  document.getElementById('reserva-onboarding').style.display = 'none';
  const painel = document.getElementById('reserva-painel');
  painel.style.display = 'block';
  renderPainelReserva();
}

window.reservaStep = function(step) {
  ['1','2','3','config'].forEach(s => {
    const el = document.getElementById('reserva-step-' + s);
    if (el) el.style.display = 'none';
  });
  const el = document.getElementById('reserva-step-' + step);
  if (el) el.style.display = 'block';

  if (step === 'config') {
    // selecionarPerfilReserva já chama renderMesesGrid internamente
    selecionarPerfilReserva(reservaPerfilSelecionado);
    renderOndeGrid();
    selecionarFonteReserva(reservaFonteSelecionada).catch(()=>{});
  }
};

window.selecionarPerfilReserva = function(perfil) {
  reservaPerfilSelecionado = perfil;
  ['clt','autonomo','empresario'].forEach(p => {
    const btn = document.getElementById('res-perfil-' + p);
    if (!btn) return;
    if (p === perfil) {
      btn.style.borderColor = 'var(--eko-green)';
      btn.style.background = 'var(--eko-green-light)';
      btn.style.color = 'var(--eko-green-dark)';
    } else {
      btn.style.borderColor = 'var(--border)';
      btn.style.background = 'var(--surface)';
      btn.style.color = 'var(--text-muted)';
    }
  });
  // Atualiza meses recomendados
  renderMesesGrid();
};

window.selecionarFonteReserva = async function(fonte) {
  reservaFonteSelecionada = fonte;
  const btns = {
    manual: document.getElementById('res-fonte-manual'),
    controle: document.getElementById('res-fonte-controle'),
  };
  Object.entries(btns).forEach(([k, btn]) => {
    if (!btn) return;
    if (k === fonte) {
      btn.style.borderColor = 'var(--eko-green)';
      btn.style.background = 'var(--eko-green-light)';
      btn.style.color = 'var(--eko-green-dark)';
    } else {
      btn.style.borderColor = 'var(--border)';
      btn.style.background = 'var(--surface)';
      btn.style.color = 'var(--text-muted)';
    }
  });

  const hint = document.getElementById('res-gastos-hint');
  const input = document.getElementById('res-gastos');

  if (fonte === 'controle') {
    // Puxa média dos últimos 3 meses do Controle Financeiro
    try {
      const agora = new Date();
      let totalGastos = 0; let mesesComDados = 0;
      for (let i = 1; i <= 3; i++) {
        const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
        const mesKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2,'0');
        const q = query(collection(db,'controle'), where('email','==',store.sessao.email), where('chaveMes','==',mesKey), where('tipo','==','gasto'));
        const snap = await getDocs(q);
        if (!snap.empty) {
          let soma = 0; snap.forEach(d2 => soma += (d2.data().valor || 0));
          totalGastos += soma; mesesComDados++;
        }
      }
      if (mesesComDados > 0) {
        const media = totalGastos / mesesComDados;
        input.value = fmtInput(media);
        hint.style.display = '';
      } else {
        input.value = '';
        hint.style.display = 'none';
        toast('Nenhum dado encontrado no Controle. Informe manualmente.');
      }
    } catch(e) { input.value = ''; }
  } else {
    hint.style.display = 'none';
  }
};

function renderMesesGrid() {
  const grid = document.getElementById('res-meses-grid');
  if (!grid) return;
  const isClt = reservaPerfilSelecionado === 'clt';
  const opcoes = isClt ? [3,4,6] : [6,9,12];
  const recomendado = isClt ? 6 : 12;
  grid.innerHTML = '';
  opcoes.forEach(m => {
    const btn = document.createElement('button');
    btn.id = 'res-meses-' + m;
    btn.dataset.meses = m;
    btn.textContent = m + ' meses' + (m === recomendado ? ' ⭐' : '');
    btn.style.cssText = 'padding:.625rem;border-radius:10px;border:2px solid var(--border);background:var(--surface);color:var(--text-muted);font-weight:700;font-size:12px;cursor:pointer;transition:all .2s';
    btn.onclick = () => {
      grid.querySelectorAll('button').forEach(b => {
        b.dataset.selected = '';
        b.style.borderColor = 'var(--border)'; b.style.background = 'var(--surface)'; b.style.color = 'var(--text-muted)';
      });
      btn.dataset.selected = 'true';
      btn.style.borderColor = 'var(--eko-green)';
      btn.style.background = 'var(--eko-green-light)';
      btn.style.color = 'var(--eko-green-dark)';
    };
    if (m === recomendado) {
      btn.dataset.selected = 'true';
      btn.style.borderColor = 'var(--eko-green)';
      btn.style.background = 'var(--eko-green-light)';
      btn.style.color = 'var(--eko-green-dark)';
    }
    grid.appendChild(btn);
  });
}

function renderOndeGrid() {
  const grid = document.getElementById('res-onde-grid');
  if (!grid) return;
  grid.innerHTML = '';
  ONDE_GUARDAR_OPCOES.forEach((op, i) => {
    const btn = document.createElement('button');
    btn.id = 'res-onde-' + op.id;
    btn.dataset.onde = op.nome || op.label;
    btn.style.cssText = 'padding:.75rem;border-radius:10px;border:2px solid var(--border);background:var(--surface);text-align:left;cursor:pointer;transition:all .2s;width:100%';
    btn.innerHTML = `<div style="font-size:13px;font-weight:800">${op.label}</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">${op.desc}</div>`;
    btn.onclick = () => {
      grid.querySelectorAll('button').forEach(b => {
        b.dataset.selected = '';
        b.style.borderColor = 'var(--border)'; b.style.background = 'var(--surface)';
      });
      btn.dataset.selected = 'true';
      btn.style.borderColor = 'var(--eko-green)';
      btn.style.background = 'var(--eko-green-light)';
    };
    if (i === 0) {
      btn.dataset.selected = 'true';
      btn.style.borderColor = 'var(--eko-green)';
      btn.style.background = 'var(--eko-green-light)';
    }
    grid.appendChild(btn);
  });
}

window.salvarConfigReserva = async function() {
  const msg = document.getElementById('res-config-msg');
  const gastoRaw = document.getElementById('res-gastos').value;
  const gastos = parseMoney(gastoRaw);
  if (!gastos || gastos <= 0) { msg.textContent = 'Informe seus gastos mensais.'; msg.className = 'msg error'; return; }

  // Pegar meses selecionado via data-selected
  const mesesGrid = document.getElementById('res-meses-grid');
  let mesesSel = null;
  if (mesesGrid) {
    const btnSel = mesesGrid.querySelector('button[data-selected="true"]');
    if (btnSel) mesesSel = parseInt(btnSel.dataset.meses);
    // fallback: pegar o primeiro se nenhum marcado
    if (!mesesSel) {
      const primeiro = mesesGrid.querySelector('button');
      if (primeiro) mesesSel = parseInt(primeiro.dataset.meses);
    }
  }
  if (!mesesSel) { msg.textContent = 'Selecione quantos meses de cobertura.'; msg.className = 'msg error'; return; }

  // Pegar onde guardar via data-selected
  let ondeSel = 'Tesouro Selic';
  const ondeGrid = document.getElementById('res-onde-grid');
  if (ondeGrid) {
    const btnSel = ondeGrid.querySelector('button[data-selected="true"]');
    if (btnSel) {
      const label = btnSel.querySelector('div')?.textContent || '';
      if (label.includes('Tesouro')) ondeSel = 'Tesouro Selic';
      else if (label.includes('CDB')) ondeSel = 'CDB 100% CDI';
      else if (label.includes('Poupança')) ondeSel = 'Poupança';
    }
  }

  const meta = gastos * mesesSel;
  const config = {
    email: store.sessao.email,
    perfil: reservaPerfilSelecionado,
    gastosMensais: gastos,
    mesesCobertura: mesesSel,
    meta: meta,
    ondeGuardar: ondeSel,
    saldoAtual: reservaConfig?.saldoAtual || 0,
    historico: reservaConfig?.historico || [],
    criadoEm: reservaConfig?.criadoEm || new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  };

  try {
    msg.textContent = 'Salvando...'; msg.className = 'msg';
    await setDoc(doc(db, 'reserva', store.sessao.email), config);
    reservaConfig = config;
  } catch(e) {
    msg.textContent = 'Erro ao salvar. Tente novamente.'; msg.className = 'msg error';
    return;
  }
  // Salvo com sucesso
  toast('Reserva configurada! 🛡️');
  // Primeiro mostrar o painel (torna os elementos visíveis), depois renderizar
  try {
    document.getElementById('reserva-onboarding').style.display = 'none';
    document.getElementById('reserva-painel').style.display = 'block';
    renderPainelReserva();
  } catch(e) { console.error('mostrarPainelReserva', e); }
  try { atualizarHubReserva(); } catch(e) {}
  try { logEko('reserva_configurada', { perfil: config.perfil, meta: config.meta }); } catch(e) {}
};

function renderPainelReserva() {
  if (!reservaConfig) return;
  const { saldoAtual, meta, mesesCobertura, gastosMensais, ondeGuardar, historico, perfil } = reservaConfig;
  const pct = Math.min(100, Math.round((saldoAtual / meta) * 100));
  const faltante = Math.max(0, meta - saldoAtual);
  const taxa = TAXAS_RENDIMENTO[ondeGuardar] || 0.1065;
  const rendimentoMes = saldoAtual * (taxa / 12);

  // Status
  let statusColor = 'var(--red)'; let statusBg = 'var(--red-light)'; let statusIcon = '🚨';
  if (pct >= 100) { statusColor = 'var(--eko-green)'; statusBg = 'var(--eko-green-light)'; statusIcon = '🛡️'; }
  else if (pct >= 50) { statusColor = 'var(--amber)'; statusBg = 'var(--amber-light)'; statusIcon = '⚠️'; }

  // Prazo estimado
  let prazoTxt = '';
  if (pct < 100 && gastosMensais > 0) {
    const aporteMedio = calcAporteMedioReserva(historico);
    if (aporteMedio > 0) {
      const meses = Math.ceil(faltante / aporteMedio);
      prazoTxt = `<div style="font-size:12px;color:var(--text-muted);margin-top:4px">⏱️ No ritmo atual, completa em ~${meses} ${meses === 1 ? 'mês' : 'meses'}</div>`;
    }
  }

  document.getElementById('res-status-card').innerHTML = `
    <div style="background:${statusBg};border:1px solid ${statusColor};border-radius:14px;padding:1.25rem">
      <div style="font-size:32px;margin-bottom:.5rem">${statusIcon}</div>
      <div style="font-size:22px;font-weight:800;color:${statusColor}">${fmt(saldoAtual)}</div>
      <div style="font-size:13px;color:var(--text-muted);margin:.25rem 0">de ${fmt(meta)} (${mesesCobertura} meses de cobertura)</div>
      <div style="background:var(--border);border-radius:99px;height:10px;margin:.75rem 0">
        <div style="background:${statusColor};height:10px;border-radius:99px;width:${pct}%;transition:width .5s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted)">
        <span>${pct}% completo</span>
        <span>Faltam ${fmt(faltante)}</span>
      </div>
      ${prazoTxt}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:.75rem">
      <div class="stat-card"><div class="slabel">Rendimento/mês</div><div style="font-size:14px;font-weight:700;color:var(--eko-green)">+${fmt(rendimentoMes)}</div></div>
      <div class="stat-card"><div class="slabel">Guardado em</div><div style="font-size:13px;font-weight:700">${ondeGuardar}</div></div>
    </div>
  `;

  // Marcos — indicador compacto de fases
  const isClt = perfil === 'clt';
  const marcosOpcoes = isClt ? [1,3,6] : [3,6,12];
  const marcosEl = document.getElementById('res-marcos');
  const faseAtual = marcosOpcoes.filter(m => saldoAtual >= gastosMensais * m).length;
  const labels = isClt
    ? ['1 mês','3 meses','6 meses']
    : ['3 meses','6 meses','12 meses'];
  const icons = ['🔴','🟡','🟢'];
  marcosEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
      ${marcosOpcoes.map((m, i) => {
        const concluido = saldoAtual >= gastosMensais * m;
        const atual = faseAtual === i;
        return `<div style="flex:1;text-align:center;padding:.5rem .25rem;border-radius:10px;background:${concluido ? 'var(--eko-green-light)' : atual ? 'var(--surface2)' : 'var(--surface)'};border:1.5px solid ${concluido ? 'var(--eko-green)' : atual ? 'var(--border-strong)' : 'var(--border)'}">
          <div style="font-size:18px">${concluido ? '✅' : icons[i]}</div>
          <div style="font-size:11px;font-weight:700;color:${concluido ? 'var(--eko-green-dark)' : 'var(--text-muted)'};margin-top:2px">${labels[i]}</div>
          <div style="font-size:10px;color:var(--text-hint);margin-top:1px">${fmt(gastosMensais * m)}</div>
        </div>`;
      }).join('<div style="font-size:14px;color:var(--border-strong);align-self:center">›</div>')}
    </div>
    ${faseAtual < marcosOpcoes.length ? `<div style="font-size:12px;color:var(--text-muted);margin-top:.625rem;text-align:center">Próxima fase: <strong>${labels[faseAtual]}</strong> — ${fmt(gastosMensais * marcosOpcoes[faseAtual])}</div>` : '<div style="font-size:12px;color:var(--eko-green);margin-top:.625rem;text-align:center;font-weight:700">🎉 Todas as fases concluídas!</div>'}
  `;

  // Histórico
  const hist = (historico || []).slice().reverse().slice(0, 10);
  const histEl = document.getElementById('res-historico');
  if (!hist.length) {
    histEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:13px;padding:1rem">Nenhum registro ainda.</div>';
  } else {
    histEl.innerHTML = hist.map(h => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.625rem 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-size:13px;font-weight:700;color:${h.tipo === 'aporte' ? 'var(--eko-green)' : 'var(--red)'}">${h.tipo === 'aporte' ? '+ ' : '- '}${fmt(h.valor)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${esc(h.descricao || h.motivo || '')} · ${new Date(h.data).toLocaleDateString('pt-BR')}</div>
        </div>
        <div style="font-size:20px">${h.tipo === 'aporte' ? '💰' : '📤'}</div>
      </div>`).join('');
  }

  // Aviso metas
  const avisoMetas = document.getElementById('res-aviso-metas');
  if (avisoMetas) avisoMetas.style.display = pct < 100 ? '' : 'none';

  // Botão "transformar em meta" — só aparece se reserva incompleta
  const btnMeta = document.getElementById('res-btn-meta');
  if (btnMeta) btnMeta.style.display = pct < 100 ? '' : 'none';
}

function calcAporteMedioReserva(historico) {
  if (!historico?.length) return 0;
  const aportes = historico.filter(h => h.tipo === 'aporte');
  if (!aportes.length) return 0;
  return aportes.reduce((s, h) => s + h.valor, 0) / aportes.length;
}

window.abrirOverlayAporteReserva = function() {
  document.getElementById('res-aporte-valor').value = '';
  document.getElementById('res-aporte-desc').value = '';
  document.getElementById('res-aporte-msg').textContent = '';
  document.getElementById('overlay-reserva-aporte').classList.remove('hidden');
};

window.salvarAporteReserva = async function() {
  const msg = document.getElementById('res-aporte-msg');
  const valor = parseMoney(document.getElementById('res-aporte-valor').value);
  if (!valor || valor <= 0) { msg.textContent = 'Informe um valor válido.'; msg.className = 'msg error'; return; }
  const desc = document.getElementById('res-aporte-desc').value.trim();

  const novoHistorico = [...(reservaConfig.historico || []), {
    tipo: 'aporte', valor, descricao: desc, data: new Date().toISOString()
  }];
  const novoSaldo = (reservaConfig.saldoAtual || 0) + valor;

  try {
    msg.textContent = 'Salvando...'; msg.className = 'msg';
    await setDoc(doc(db, 'reserva', store.sessao.email), {
      ...reservaConfig, saldoAtual: novoSaldo, historico: novoHistorico, atualizadoEm: new Date().toISOString()
    });
    reservaConfig.saldoAtual = novoSaldo;
    reservaConfig.historico = novoHistorico;
    fecharOverlay('overlay-reserva-aporte');
  } catch(e) { msg.textContent = 'Erro ao salvar.'; msg.className = 'msg error'; return; }
  toast('Aporte registrado! 💰');
  try { renderPainelReserva(); } catch(e) { console.error('renderPainel aporte', e); }
  try { atualizarHubReserva(); } catch(e) {}
  try { logEko('reserva_aporte', { valor }); } catch(e) {}
};

window.abrirOverlayUsarReserva = function() {
  document.getElementById('res-uso-valor').value = '';
  document.getElementById('res-uso-motivo').value = '';
  document.getElementById('res-uso-msg').textContent = '';
  document.getElementById('overlay-reserva-uso').classList.remove('hidden');
};

window.salvarUsoReserva = async function() {
  const msg = document.getElementById('res-uso-msg');
  const valor = parseMoney(document.getElementById('res-uso-valor').value);
  if (!valor || valor <= 0) { msg.textContent = 'Informe um valor válido.'; msg.className = 'msg error'; return; }
  const motivo = document.getElementById('res-uso-motivo').value.trim();

  const novoSaldo = Math.max(0, (reservaConfig.saldoAtual || 0) - valor);
  const novoHistorico = [...(reservaConfig.historico || []), {
    tipo: 'uso', valor, motivo, data: new Date().toISOString()
  }];

  try {
    msg.textContent = 'Salvando...'; msg.className = 'msg';
    await setDoc(doc(db, 'reserva', store.sessao.email), {
      ...reservaConfig, saldoAtual: novoSaldo, historico: novoHistorico, atualizadoEm: new Date().toISOString()
    });
    reservaConfig.saldoAtual = novoSaldo;
    reservaConfig.historico = novoHistorico;
    fecharOverlay('overlay-reserva-uso');
  } catch(e) { msg.textContent = 'Erro ao salvar.'; msg.className = 'msg error'; return; }
  toast('Uso registrado. Lembre-se de reconstruir a reserva! 💪');
  try { renderPainelReserva(); } catch(e) { console.error('renderPainel uso', e); }
  try { atualizarHubReserva(); } catch(e) {}
  try { logEko('reserva_uso', { valor }); } catch(e) {}
};


window.criarMetaReserva = function() {
  if (!reservaConfig) return;
  const { saldoAtual, meta, gastosMensais, mesesCobertura } = reservaConfig;
  const faltante = Math.max(0, meta - saldoAtual);

  if (faltante <= 0) {
    toast('Sua reserva já está completa! 🎉');
    return;
  }

  // Calcular mensal sugerido pelo histórico
  const aporteMedio = calcAporteMedioReserva(reservaConfig.historico || []);
  const mensal = aporteMedio > 0 ? aporteMedio : 0;
  const prazo = mensal > 0 ? Math.ceil(faltante / mensal) : null;

  // Preencher info
  const infoEl = document.getElementById('res-meta-info');
  infoEl.innerHTML = `
    <div style="font-weight:800;margin-bottom:.375rem">🛡️ Reserva de Emergência</div>
    <div>Valor faltante: <strong>${fmt(faltante)}</strong></div>
    ${mensal > 0 ? `<div>Aporte médio atual: <strong>${fmt(mensal)}/mês</strong> → completa em ~${prazo} ${prazo===1?'mês':'meses'}</div>` : '<div style="color:var(--amber)">Sem histórico de aportes — informe um valor mensal</div>'}
  `;

  // Pré-preencher mensal se tiver histórico
  const input = document.getElementById('res-meta-mensal');
  input.value = mensal > 0 ? fmtInput(mensal) : '';
  document.getElementById('res-meta-msg').textContent = '';
  document.getElementById('res-meta-msg').className = 'msg';

  abrirOverlay('overlay-reserva-meta');
};

window.confirmarMetaReserva = async function() {
  if (!reservaConfig) return;
  const msg = document.getElementById('res-meta-msg');
  const mensal = parseMoney(document.getElementById('res-meta-mensal').value);
  if (!mensal || mensal <= 0) {
    msg.textContent = 'Informe um valor mensal.';
    msg.className = 'msg error';
    return;
  }

  const { saldoAtual, meta } = reservaConfig;
  const faltante = Math.max(0, meta - saldoAtual);
  const meses = Math.ceil(faltante / mensal);
  const inicio = new Date().toISOString().slice(0, 7);

  const novaMeta = {
    nome: '🛡️ Reserva de Emergência',
    meta: faltante,
    meses,
    dia: 1,
    inicio,
    mensal,
    catIcon: '🛡️',
    catNome: 'Reserva',
    saldoExtra: 0,
    depositos: Array(meses).fill(null).map(() => ({pago:false, parcial:false, extra:false, valor:0})),
    email: store.sessao.email,
    origemReserva: true,
  };

  try {
    msg.textContent = 'Criando meta...'; msg.className = 'msg';
    await saveMeta2(novaMeta);
    fecharOverlay('overlay-reserva-meta');
    toast('Meta criada! 🎯 Veja em Metas Financeiras.');
    logEko('reserva_meta_criada', { mensal, meses });
  } catch(e) {
    msg.textContent = 'Erro ao criar meta. Tente novamente.';
    msg.className = 'msg error';
  }
};

window.excluirReserva = async function() {
  if (!confirm('Tem certeza que deseja excluir sua reserva de emergência? Todo o histórico será perdido.')) return;
  try {
    await deleteDoc(doc(db, 'reserva', store.sessao.email));
    reservaConfig = null;
    mostrarOnboardingReserva();
    reservaStep(1);
    atualizarHubReserva();
    toast('Reserva excluída.');
    logEko('reserva_excluida');
  } catch(e) {
    toast('Erro ao excluir. Tente novamente.');
  }
};

window.reservaVerEducativo = function() {
  document.getElementById('reserva-onboarding').style.display = 'block';
  document.getElementById('reserva-painel').style.display = 'none';
  reservaStep(1);
};

window.reservaReconfigurar = function() {
  mostrarOnboardingReserva();
  reservaStep('config');
  renderMesesGrid();
  renderOndeGrid();
  selecionarPerfilReserva(reservaConfig?.perfil || 'clt');
  // Pre-preenche gastos
  if (reservaConfig?.gastosMensais) {
    document.getElementById('res-gastos').value = fmtInput(reservaConfig.gastosMensais);
  }
};

async function atualizarHubReserva() {
  const el = document.getElementById('hub-reserva-sub');
  if (!el) return;
  try {
    const snap = await getDoc(doc(db, 'reserva', store.sessao.email));
    if (snap.exists()) {
      const { saldoAtual, meta } = snap.data();
      const pct = Math.min(100, Math.round((saldoAtual / meta) * 100));
      el.textContent = pct >= 100 ? '✅ Reserva completa!' : `${pct}% — ${fmt(saldoAtual)} de ${fmt(meta)}`;
    } else {
      el.textContent = '⚠️ Ainda não configurada';
    }
  } catch(e) {}
}

export { atualizarHubReserva };
