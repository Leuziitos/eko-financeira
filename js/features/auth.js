/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/auth.js
 * Autenticação e perfil: login (Firebase Auth), MIGRAÇÃO
 * LEGADA SHA-256 (fazerLogin: fallback para hash antigo no
 * Firestore → cria conta no Auth → remove o hash; bloco movido
 * intacto — NÃO ALTERAR), cadastro, logout, reset de senha,
 * perfil (hook onEnter registrado aqui) e carregarApp (boot
 * pós-autenticação: renderiza hub/prontuário/diagnósticos,
 * inicializa push e o listener em tempo real de metas).
 * Corpo movido verbatim; ordem original das faixas preservada.
 * ═══════════════════════════════════════════════════════════ */

import { SESS_KEY } from '../config.js';
import { db, auth, logEko, doc, getDoc, setDoc, collection, query, where, onSnapshot, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from '../core/firebase.js';
import { store } from '../core/store.js';
import { ir, onEnter } from '../core/router.js';
import { parseMoney, setupMoneyInputs } from '../utils/money.js';
import { showMsg, limparMsg, toast } from '../utils/dom.js';
import { renderHub } from './hub.js';
import { renderProntuario } from './prontuario.js';
import { renderDiagnosticos } from './diagnosticos.js';
import { inicializarPush, inicializarMensagensPush } from './push-optin.js';

let _unsubscribeMetas = null; // guarda unsubscribe do onSnapshot

// hashSenha mantido para migração de usuários legados (hash antigo no Firestore)
async function hashSenha(s) { const e = new TextEncoder().encode(s); const b = await crypto.subtle.digest('SHA-256', e); return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,'0')).join(''); }

// ── FIRESTORE ──────────────────────────────────────────────
async function getUser(email) { const snap = await getDoc(doc(db,'users',email)); return snap.exists() ? snap.data() : null; }
async function setUser(email, data) { await setDoc(doc(db,'users',email), data); }

// ── AUTH ──────────────────────────────────────────────
async function carregarApp() {
  try {
    const user = await getUser(store.sessao.email);
    if (!user) { localStorage.removeItem(SESS_KEY); ir('screen-login'); return; }
    store.sessao.nome = user.nome;
    store.sessao.renda = user.renda || 0;
    const hora = new Date().getHours();
    const saud = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
    document.getElementById('hub-greeting').textContent = saud + ', ' + user.nome.split(' ')[0] + '! 👋';
    setupMoneyInputs(); // FASE 4 BUG 5 — máscara monetária
    // Item 1 — listener em tempo real para badge de metas no hub
    try {
      const metasQ = query(collection(db,'metas'), where('email','==',store.sessao.email));
      if (_unsubscribeMetas) { _unsubscribeMetas(); _unsubscribeMetas = null; }
      _unsubscribeMetas = onSnapshot(metasQ, (snap) => {
        const metas = [];
        snap.forEach(d => metas.push(d.data()));
        const ativas = metas.filter(m=>!m.concluida).length;
        const conc   = metas.filter(m=>m.concluida).length;
        const sub = document.getElementById('hub-metas-sub');
        if(sub){
          if(!metas.length) sub.textContent='Nenhuma meta ainda';
          else sub.innerHTML=`${ativas} ativa(s)${conc>0?' · <span style="color:var(--eko-green)">'+conc+' concluída(s) 🏆</span>':''}`;
        }
      });
    } catch(e){ console.error('onSnapshot metas',e); }
    try { await renderHub(); } catch(e) { console.error('renderHub error:', e); }
  try { await inicializarPush(); } catch(e) {}
  try { inicializarMensagensPush(); } catch(e) {}
    try { await renderProntuario(); } catch(e) { console.error('renderProntuario error:', e); }
    try { await renderDiagnosticos(); } catch(e) { console.error('renderDiagnosticos error:', e); }
    ir('screen-hub');
  } catch(e) {
    console.error('carregarApp error:', e);
    ir('screen-hub');
  }
}

window.fazerLogin = async function() {
  limparMsg('login-msg');
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const senha = document.getElementById('login-senha').value;
  if (!email||!senha) { showMsg('login-msg','error','Preencha e-mail e senha.'); return; }

  // Tenta Firebase Auth primeiro (usuários novos)
  try {
    await signInWithEmailAndPassword(auth, email, senha);
    logEko('login', { method: 'email' });
    return; // sucesso — onAuthStateChanged cuida do resto
  } catch(authErr) {
    // Se o erro não é de senha errada, pode ser usuário antigo (não migrado)
    if (authErr.code === 'auth/invalid-credential' || authErr.code === 'auth/user-not-found') {
      // Tenta login legado com hash
      try {
        const user = await getUser(email);
        if (user && user.hash) {
          const hash = await hashSenha(senha);
          if (hash === user.hash) {
            // Senha correta! Migra para Firebase Auth agora
            try {
              await createUserWithEmailAndPassword(auth, email, senha);
            } catch(createErr) {
              if (createErr.code !== 'auth/email-already-in-use') throw createErr;
              // Já existe no Auth mas senha diferente — força reset não é possível aqui
              // Apenas avisa o usuário
              showMsg('login-msg','error','Sua conta precisa de uma nova senha. Use "Esqueci minha senha" ou entre em contato.');
              return;
            }
            // Remove o hash do Firestore por segurança
            const userAtualizado = {...user};
            delete userAtualizado.hash;
            await setUser(email, userAtualizado);
            toast('✅ Conta migrada com segurança!');
            return; // onAuthStateChanged cuida do carregarApp
          } else {
            showMsg('login-msg','error','Senha incorreta.');
            return;
          }
        }
      } catch(legacyErr) {
        console.error('legacy login error', legacyErr);
      }
    }
    // Erros conhecidos do Firebase Auth
    const erros = {
      'auth/wrong-password':'Senha incorreta.',
      'auth/invalid-credential':'E-mail ou senha incorretos.',
      'auth/too-many-requests':'Muitas tentativas. Aguarde alguns minutos.',
      'auth/network-request-failed':'Sem conexão. Verifique sua internet.',
    };
    showMsg('login-msg','error', erros[authErr.code] || 'Erro ao entrar. Tente novamente.');
  }
};

window.criarConta = async function() {
  limparMsg('cad-msg');
  const nome = document.getElementById('cad-nome').value.trim();
  const email = document.getElementById('cad-email').value.trim().toLowerCase();
  const whatsapp = document.getElementById('cad-whatsapp').value.trim();
  const renda = parseMoney(document.getElementById('cad-renda').value) || 0;
  const senha = document.getElementById('cad-senha').value;
  if (!nome||!email||!senha) { showMsg('cad-msg','error','Preencha nome, e-mail e senha.'); return; }
  if (senha.length < 8) { showMsg('cad-msg','error','Senha com ao menos 8 caracteres.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showMsg('cad-msg','error','E-mail inválido.'); return; }
  try {
    await createUserWithEmailAndPassword(auth, email, senha);
    // Salva dados adicionais no Firestore (Firebase Auth só guarda email/senha)
    await setUser(email, {nome, email, whatsapp:whatsapp.replace(/\D/g,''), renda, criadoEm:new Date().toISOString()});
    logEko('sign_up', { method: 'email' });
    // onAuthStateChanged cuida do resto
  } catch(e) {
    const erros = { 'auth/email-already-in-use':'E-mail já cadastrado.', 'auth/weak-password':'Senha fraca — use ao menos 8 caracteres.', 'auth/invalid-email':'E-mail inválido.' };
    showMsg('cad-msg','error', erros[e.code] || 'Erro ao criar conta. Tente novamente.');
  }
};

window.logout = async function() {
  if (_unsubscribeMetas) { _unsubscribeMetas(); _unsubscribeMetas = null; }
  try { await signOut(auth); } catch(e) {}
  store.sessao = null;
  localStorage.removeItem(SESS_KEY);
  document.getElementById('login-email').value = '';
  document.getElementById('login-senha').value = '';
  limparMsg('login-msg');
  ir('screen-login');
};

window.enviarResetSenha = async function() {
  limparMsg('reset-msg');
  const email = document.getElementById('reset-email').value.trim().toLowerCase();
  if (!email) { showMsg('reset-msg','error','Digite seu e-mail cadastrado.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showMsg('reset-msg','error','E-mail inválido.'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    showMsg('reset-msg','success','✅ E-mail enviado! Verifique sua caixa de entrada (e o spam).');
    document.getElementById('reset-email').value = '';
    // Volta ao login após 4 segundos
    setTimeout(() => ir('screen-login'), 4000);
  } catch(e) {
    const erros = {
      'auth/user-not-found': 'E-mail não encontrado. Verifique ou crie uma conta.',
      'auth/invalid-email':  'E-mail inválido.',
      'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos.',
    };
    showMsg('reset-msg','error', erros[e.code] || 'Erro ao enviar. Tente novamente.');
  }
};

// ── PERFIL ──────────────────────────────────────────────
window.salvarPerfil = async function() {
  limparMsg('perfil-msg');
  const nome = document.getElementById('perfil-nome').value.trim();
  const whatsapp = document.getElementById('perfil-whatsapp').value.trim();
  const renda = parseMoney(document.getElementById('perfil-renda').value) || 0;
  if (!nome) { showMsg('perfil-msg','error','Nome obrigatório.'); return; }
  const user = await getUser(store.sessao.email);
  await setUser(store.sessao.email, {...user, nome, whatsapp:whatsapp.replace(/\D/g,''), renda});
  store.sessao.nome = nome; store.sessao.renda = renda;
  localStorage.setItem(SESS_KEY, JSON.stringify(store.sessao));
  showMsg('perfil-msg','success','Perfil atualizado!');
  toast('✅ Perfil atualizado!');
};

async function carregarPerfil() {
  const user = await getUser(store.sessao.email);
  if (!user) return;
  document.getElementById('perfil-nome').value = user.nome || '';
  document.getElementById('perfil-whatsapp').value = user.whatsapp || '';
  document.getElementById('perfil-renda').value = user.renda ? 'R$ ' + Number(user.renda).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}) : '';
  document.getElementById('perfil-email').value = user.email || '';
}
// Carregar perfil quando entrar na tela (hook do router — substitui o antigo monkey-patch de window.ir)
onEnter('screen-perfil', carregarPerfil);

export { carregarApp, getUser };
