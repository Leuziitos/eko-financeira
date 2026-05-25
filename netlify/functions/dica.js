exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
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
