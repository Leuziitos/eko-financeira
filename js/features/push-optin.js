/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/push-optin.js
 * Opt-in de notificações push (OneSignal): card próprio no hub
 * (não usa o prompt nativo do SDK), cooldown de 7 dias,
 * vínculo do e-mail (external_id) e toast para mensagens em
 * foreground. Interage com window.OneSignalDeferred, criado
 * pelo script clássico de init (fora do grafo de módulos).
 * Corpo movido verbatim do monólito.
 * ═══════════════════════════════════════════════════════════ */

import { PUSH_OPTIN_KEY } from '../config.js';
import { store } from '../core/store.js';
import { logEko } from '../core/firebase.js';
import { toast } from '../utils/dom.js';

// ════ PUSH NOTIFICATIONS — OneSignal ════════════════════════

async function inicializarPush() {
  if (!('Notification' in window)) return;
  if (!('serviceWorker' in navigator)) return;
  if (typeof OneSignalDeferred === 'undefined') return;

  const optinKey = PUSH_OPTIN_KEY + (store.sessao?.email || '');
  const jaRespondeu = localStorage.getItem(optinKey);

  // Se já tem permissão concedida, vincular email silenciosamente
  if (Notification.permission === 'granted') {
    await vincularEmailOneSignal();
    return;
  }

  // Se negou ou já perguntou nos últimos 7 dias, não perguntar
  if (Notification.permission === 'denied') return;
  if (jaRespondeu) {
    const ts = parseInt(jaRespondeu);
    if (Date.now() - ts < 7 * 24 * 60 * 60 * 1000) return;
  }

  // Mostrar card de opt-in no hub
  const el = document.getElementById('hub-push-optin');
  if (!el) return;
  el.style.display = '';
  el.innerHTML = `
    <div style="background:linear-gradient(135deg,var(--eko-green-light),var(--surface));border:1px solid var(--eko-green);border-radius:14px;padding:1rem;display:flex;align-items:center;gap:12px">
      <div style="font-size:28px;flex-shrink:0">📱</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:800;color:var(--eko-green-dark)">Ative as notificações!</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Receba dicas e lembretes financeiros no celular.</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
        <button onclick="ativarPush()" style="background:var(--eko-green);color:var(--dark);border:none;border-radius:8px;padding:.4rem .75rem;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit">Ativar</button>
        <button onclick="dispensarPush()" style="background:none;border:none;color:var(--text-muted);font-size:11px;cursor:pointer;font-family:inherit">Agora não</button>
      </div>
    </div>`;
}

window.ativarPush = async function() {
  try {
    const el = document.getElementById('hub-push-optin');
    if (el) el.style.display = 'none';

    // Solicitar permissão nativa DIRETAMENTE no clique (sem async queue)
    const perm = await Notification.requestPermission();

    if (perm === 'granted') {
      // Vincular ao OneSignal após permissão concedida
      OneSignalDeferred.push(async (os) => {
        await os.User.PushSubscription.optIn();
        await os.login(store.sessao?.email || '');
      });
      toast('📱 Notificações ativadas! 🌱');
      logEko('push_ativado');
    } else {
      dispensarPush();
    }
  } catch(e) {
    console.error('Erro ao ativar push:', e);
  }
};

window.dispensarPush = function() {
  const el = document.getElementById('hub-push-optin');
  if (el) el.style.display = 'none';
  const optinKey = PUSH_OPTIN_KEY + (store.sessao?.email || '');
  localStorage.setItem(optinKey, Date.now().toString());
};

async function vincularEmailOneSignal() {
  if (!store.sessao?.email) return;
  try {
    OneSignalDeferred.push(async (os) => {
      // Vincular email do usuário ao dispositivo no OneSignal
      await os.login(store.sessao.email);
      console.log('✅ OneSignal: usuário vinculado -', store.sessao.email);
    });
  } catch(e) {
    console.error('Erro ao vincular email OneSignal:', e);
  }
}

// Receber mensagem com app aberto (OneSignal cuida disso automaticamente)
function inicializarMensagensPush() {
  // OneSignal exibe as notificações automaticamente via SW
  // Aqui apenas registramos o listener para foreground
  if (typeof OneSignalDeferred === 'undefined') return;
  try {
    OneSignalDeferred.push((os) => {
      os.Notifications.addEventListener('foregroundWillDisplay', (event) => {
        const { title, body } = event.notification;
        toast(`${title || 'Eko'}: ${body || ''}`);
        event.preventDefault(); // Não exibir notificação nativa em foreground, usar toast
      });
    });
  } catch(e) {}
}

export { inicializarPush, inicializarMensagensPush };
