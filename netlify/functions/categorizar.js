// Função de rate limiting via Upstash Redis
async function checkRateLimit(ip) {
  const key = `rate:categorizar:${ip}`;
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

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Validar Origin — só aceitar chamadas do app (mesma proteção de dica.js)
  const origin = event.headers['origin'] || '';
  const allowedOrigins = [
    'https://app.ekofinanceira.com.br',
    'https://ekofinanceira.com.br'
  ];
  if (!allowedOrigins.includes(origin)) {
    return { statusCode: 403, body: 'Forbidden' };
  }

  // Rate limiting por IP
  try {
    const ip = event.headers['x-forwarded-for'] || 'unknown';
    const limited = await checkRateLimit(ip);
    if (limited) {
      return { statusCode: 429, body: 'Too Many Requests' };
    }
  } catch (e) {
    console.warn('[rate-limit] check failed:', e.message);
  }

  try {
    const { descricoes } = JSON.parse(event.body || '{}');

    if (!Array.isArray(descricoes) || !descricoes.length) {
      return { statusCode: 400, body: JSON.stringify({ sugestoes: [] }) };
    }
    // Limite de segurança — o cliente já manda em lotes de 50 (ver
    // categorizer.js), isso aqui só protege contra abuso direto da function.
    const lista = descricoes.slice(0, 100).map(d => String(d || '').slice(0, 200));

    const prompt = `Categorize cada descrição de transação bancária brasileira em uma das categorias: Moradia, Alimentação, Transporte, Saúde, Educação, Lazer, Compras, Beleza, Viagem, Serviços, Contas fixas, Impostos, Negócio, Metas, Dívidas, Outras. Responda apenas em JSON: [{descricao, categoria}]

Descrições:
${JSON.stringify(lista)}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const texto = data?.content?.[0]?.text?.trim() || '[]';

    let sugestoes = [];
    try {
      // A IA pode envolver o JSON em ```json ... ``` mesmo quando instruída
      // a não fazer isso — extrai só o trecho entre o primeiro '[' e o
      // último ']' antes de fazer o parse.
      const inicio = texto.indexOf('[');
      const fim = texto.lastIndexOf(']');
      const bruto = inicio >= 0 && fim >= inicio ? texto.slice(inicio, fim + 1) : texto;
      const parsed = JSON.parse(bruto);
      if (Array.isArray(parsed)) {
        sugestoes = parsed
          .filter(s => s && typeof s.descricao === 'string' && typeof s.categoria === 'string')
          .map(s => ({ descricao: s.descricao, categoria: s.categoria }));
      }
    } catch(e) {
      console.error('categorizar: falha ao parsear resposta da IA', e.message);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sugestoes })
    };

  } catch(e) {
    console.error('categorizar function error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ sugestoes: [] })
    };
  }
};
