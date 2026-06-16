// Função de rate limiting via Upstash Redis
async function checkRateLimit(ip) {
  const key = `rate:dica:${ip}`;
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

  return count > 10; // Máximo 10 requests por minuto por IP
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Validar Origin — só aceitar chamadas do app
  const origin = event.headers['origin'] || '';
  const allowedOrigins = [
    'https://app.ekofinanceira.com.br',
    'https://ekofinanceira.com.br'
  ];
  if (!allowedOrigins.includes(origin)) {
    return { statusCode: 403, body: 'Forbidden' };
  }

  // Rate limiting por IP
  const ip = event.headers['x-forwarded-for'] || 'unknown';
  const limited = await checkRateLimit(ip);
  if (limited) {
    return { statusCode: 429, body: 'Too Many Requests' };
  }

  try {
    const { contexto } = JSON.parse(event.body || '{}');

    const prompt = `Você é um assistente de educação financeira do app Eko Financeira, desenvolvido por Leonardo Braulino (Projeto PEF).

Contexto do usuário: ${contexto || 'usuário iniciando no app'}.

Gere UMA dica financeira prática, motivadora e personalizada para este usuário.
Regras:
- Máximo 2 frases curtas e diretas
- Tom encorajador e acessível, sem jargões
- Baseada no contexto do usuário quando disponível
- Sem emojis excessivos — apenas 1 no início
- Não cite valores exatos do usuário, use referências gerais
- Responda APENAS com o texto da dica, sem título nem introdução`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 120,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const dica = data?.content?.[0]?.text?.trim() || '';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dica })
    };

  } catch(e) {
    console.error('dica function error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ dica: '' })
    };
  }
};
