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

// Dispara notificação via OneSignal para um email específico
async function enviarNotificacao(email, notif) {
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    filters: [{ field: 'external_user_id', relation: '=', value: email }],
    headings: { en: notif.title },
    contents: { en: notif.body },
    url: 'https://app.ekofinanceira.com.br',
    chrome_web_icon: 'https://app.ekofinanceira.com.br/icons/icon-192x192.png',
    firefox_icon: 'https://app.ekofinanceira.com.br/icons/icon-192x192.png',
  };

  const response = await fetch('https://api.onesignal.com/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Key ${ONESIGNAL_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OneSignal error: ${response.status} — ${err}`);
  }

  return await response.json();
}

exports.handler = async (event) => {
  // Verificar autorização
  const authHeader = event.headers['x-push-secret'] || event.headers['authorization'];
  if (authHeader !== process.env.PUSH_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const tipo = event.queryStringParameters?.tipo || 'gastos';
  const hoje = new Date().toISOString().slice(0, 10);
  const diaMes = new Date().getDate();
  const diaSemana = new Date().getDay(); // 0=dom, 1=seg

  try {
    // Buscar todos os usuários únicos com push ativo via OneSignal
    // Usamos o Firestore para obter a lista de emails cadastrados no app
    const usuariosSnap = await db.collection('users').get();
    if (usuariosSnap.empty) return { statusCode: 200, body: 'Nenhum usuário cadastrado' };

    const resultados = { enviados: 0, pulados: 0, erros: 0 };

    for (const userDoc of usuariosSnap.docs) {
      const email = userDoc.data().email || userDoc.id;
      if (!email) continue;

      let deveEnviar = false;
      let notif = TIPOS[tipo];

      // ── Dica semanal (só segunda-feira = dia 1)
      if (tipo === 'dica') {
        deveEnviar = diaSemana === 1;
      }

      // ── Lembrete de gastos (só se não registrou hoje)
      else if (tipo === 'gastos') {
        const lancSnap = await db.collection('controle')
          .where('email', '==', email)
          .where('data', '>=', hoje + 'T00:00:00.000Z')
          .where('data', '<=', hoje + 'T23:59:59.999Z')
          .limit(1).get();
        deveEnviar = lancSnap.empty;
      }

      // ── Aporte em metas (todo dia 20)
      else if (tipo === 'meta') {
        deveEnviar = diaMes === 20;
        if (deveEnviar) {
          const metasSnap = await db.collection('metas').where('email', '==', email).limit(1).get();
          const objSnap = await db.collection('objetivos').where('email', '==', email).limit(1).get();
          deveEnviar = !metasSnap.empty || !objSnap.empty;
        }
      }

      // ── Aporte na reserva (todo dia 5)
      else if (tipo === 'reserva') {
        deveEnviar = diaMes === 5;
        if (deveEnviar) {
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
        if (deveEnviar && !dividasSnap.empty) {
          const nomeDivida = dividasSnap.docs[0].data().nome || 'uma dívida';
          notif = { title: '💳 Vencimento amanhã!', body: `"${nomeDivida}" vence amanhã. Já se programou?` };
        }
      }

      if (!deveEnviar) { resultados.pulados++; continue; }

      // Enviar via OneSignal
      try {
        await enviarNotificacao(email, notif);
        resultados.enviados++;
      } catch (e) {
        console.error(`Erro ao enviar para ${email}:`, e.message);
        resultados.erros++;
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ tipo, ...resultados }),
    };
  } catch (e) {
    console.error('Erro push:', e);
    return { statusCode: 500, body: e.message };
  }
};
