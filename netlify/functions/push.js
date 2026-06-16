const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Inicializar Firebase Admin
if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}

const db = getFirestore();

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;

// Tipos de notificação
const TIPOS = {
  dica:    { title: '🌱 Dica Financeira', body: 'Sua dica semanal está esperando no app!' },
  gastos:  { title: '📊 Registrou seus gastos hoje?', body: 'Manter o controle é o primeiro passo para a liberdade financeira.' },
  meta:    { title: '🎯 Hora do aporte!', body: 'Lembre de fazer seu aporte nas metas este mês.' },
  reserva: { title: '🛡️ Reserva de Emergência', body: 'Dia 5 chegou! Lembre de aportar na sua reserva.' },
  divida:  { title: '💳 Vencimento amanhã!', body: 'Você tem uma dívida vencendo amanhã. Já se programou?' },
};

// Função de rate limiting via Upstash Redis
async function checkRateLimit(ip) {
  const key = `rate:push:${ip}`;
  const baseUrl = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  const res = await fetch(`${baseUrl}/incr/${key}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const { result: count } = await res.json();

  if (count === 1) {
    await fetch(`${baseUrl}/expire/${key}/60`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  return count > 5; // Máximo 5 requests por minuto por IP
}

// Dispara notificação via OneSignal para lista de external_user_ids (emails)
// Se a lista estiver vazia, envia para todos os subscribers
async function enviarNotificacaoLote(emails, notif) {
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    headings: { en: notif.title },
    contents: { en: notif.body },
    url: 'https://app.ekofinanceira.com.br',
    chrome_web_icon: 'https://app.ekofinanceira.com.br/icons/icon-192x192.png',
    firefox_icon: 'https://app.ekofinanceira.com.br/icons/icon-192x192.png',
  };

  if (emails && emails.length > 0) {
    payload.include_aliases = { external_id: emails };
    payload.target_channel = 'push';
  } else {
    payload.included_segments = ['Total Subscriptions'];
  }

  const response = await fetch('https://api.onesignal.com/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Key ${ONESIGNAL_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`OneSignal error: ${response.status} — ${responseText}`);
  }

  return JSON.parse(responseText);
}

exports.handler = async (event) => {
  // Verificar autorização — exige header x-push-secret obrigatoriamente
  const secret = event.headers['x-push-secret'];
  if (!secret || secret !== process.env.PUSH_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  // Só aceitar GET e POST
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Rate limiting por IP
  try {
    const ip = event.headers['x-forwarded-for'] || 'unknown';
    const limited = await checkRateLimit(ip);
    if (limited) {
      return { statusCode: 429, body: 'Too Many Requests' };
    }
  } catch (e) {
    console.warn('Rate limit check failed, continuing:', e.message);
  }

  const tipo = event.queryStringParameters?.tipo || 'gastos';
  const hoje = new Date().toISOString().slice(0, 10);
  const diaMes = new Date().getDate();
  const diaSemana = new Date().getDay(); // 0=dom, 1=seg

  try {
    // ── Dica semanal — envia para todos (só segunda)
    if (tipo === 'dica') {
      if (diaSemana !== 1) return { statusCode: 200, body: JSON.stringify({ tipo, msg: 'Não é segunda-feira' }) };
      const result = await enviarNotificacaoLote([], TIPOS.dica);
      return { statusCode: 200, body: JSON.stringify({ tipo, result }) };
    }

    // Para os outros tipos, filtra por usuário
    const usuariosSnap = await db.collection('users').get();
    if (usuariosSnap.empty) return { statusCode: 200, body: 'Nenhum usuário cadastrado' };

    const emailsParaEnviar = [];

    for (const userDoc of usuariosSnap.docs) {
      const email = userDoc.data().email || userDoc.id;
      if (!email) continue;

      let deveEnviar = false;

      // ── Lembrete de gastos (só se não registrou hoje)
      if (tipo === 'gastos') {
        const lancSnap = await db.collection('controle')
          .where('email', '==', email)
          .where('data', '>=', hoje + 'T00:00:00.000Z')
          .where('data', '<=', hoje + 'T23:59:59.999Z')
          .limit(1).get();
        deveEnviar = lancSnap.empty;
      }

      // ── Aporte em metas (todo dia 20)
      else if (tipo === 'meta') {
        if (diaMes === 20) {
          const metasSnap = await db.collection('metas').where('email', '==', email).limit(1).get();
          const objSnap = await db.collection('objetivos').where('email', '==', email).limit(1).get();
          deveEnviar = !metasSnap.empty || !objSnap.empty;
        }
      }

      // ── Aporte na reserva (todo dia 5)
      else if (tipo === 'reserva') {
        if (diaMes === 5) {
          const resDoc = await db.collection('reserva').doc(email).get();
          const res = resDoc.data();
          deveEnviar = resDoc.exists && res && (res.saldoAtual || 0) < res.meta;
        }
      }

      // ── Vencimento de dívida (1 dia antes)
      else if (tipo === 'divida') {
        const amanha = new Date();
        amanha.setDate(amanha.getDate() + 1);
        const diaAmanha = amanha.getDate();
        const dividasSnap = await db.collection('dividas')
          .where('email', '==', email)
          .where('vencimento', '==', diaAmanha).get();
        deveEnviar = !dividasSnap.empty;
      }

      if (deveEnviar) emailsParaEnviar.push(email);
    }

    if (emailsParaEnviar.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ tipo, enviados: 0, msg: 'Nenhum usuário elegível' }) };
    }

    // Enviar em lote para todos os elegíveis de uma vez
    const notif = TIPOS[tipo];
    const result = await enviarNotificacaoLote(emailsParaEnviar, notif);

    return {
      statusCode: 200,
      body: JSON.stringify({ tipo, elegíveis: emailsParaEnviar.length, result }),
    };

  } catch (e) {
    console.error('Erro push:', e);
    return { statusCode: 500, body: e.message };
  }
};
