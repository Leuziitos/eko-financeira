/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/importacao/normalizer.js
 * Normalização das transações extraídas pelos parsers (OFX/CSV):
 * formato de data, valor, tipo e descrição padronizados antes da
 * deduplicação e categorização.
 *
 * normalizarDescricao(): remove prefixos/códigos/ruído da
 * descrição crua do banco e, quando reconhece uma marca conhecida
 * (MARCAS_CONHECIDAS), retorna o nome canônico dela — senão cai
 * para capitalização em título ("Title Case") do que sobrou.
 * ═══════════════════════════════════════════════════════════ */

// Prefixos comuns de extrato bancário — removidos do início da descrição,
// nessa ordem (o primeiro que bater é aplicado; não acumula mais de um).
const PREFIXOS_COMUNS = [
  /^COMPRA\s+CARTAO\s*/i,
  /^PGTO\s+PIX\s*/i,
  /^TRANSF\s+PIX\s*/i,
  /^COMPRA\s+/i,
  /^DEBITO\s+/i,
];

// Marcas conhecidas — chave em minúsculas (comparada por palavra inteira,
// não substring solta, pra não bater "tim" dentro de outra palavra) →
// nome canônico exibido ao usuário.
export const MARCAS_CONHECIDAS = {
  'uber eats': 'Uber Eats',
  'uber': 'Uber',
  '99app': '99',
  '99food': '99Food',
  'ifood': 'iFood',
  'rappi': 'Rappi',
  'netflix': 'Netflix',
  'spotify': 'Spotify',
  'youtube': 'YouTube Premium',
  'disney': 'Disney+',
  'hbo max': 'HBO Max',
  'globoplay': 'Globoplay',
  'amazon prime': 'Amazon Prime',
  'amazon': 'Amazon',
  'mercado livre': 'Mercado Livre',
  'mercadolivre': 'Mercado Livre',
  'magazine luiza': 'Magazine Luiza',
  'magalu': 'Magazine Luiza',
  'americanas': 'Americanas',
  'shopee': 'Shopee',
  'shein': 'Shein',
  'mcdonalds': "McDonald's",
  'burger king': 'Burger King',
  'burgerking': 'Burger King',
  'habibs': "Habib's",
  'subway': 'Subway',
  'starbucks': 'Starbucks',
  'outback': 'Outback',
  'kfc': 'KFC',
  'carrefour': 'Carrefour',
  'pao de acucar': 'Pão de Açúcar',
  'extra hipermercado': 'Extra',
  'drogasil': 'Drogasil',
  'droga raia': 'Droga Raia',
  'drograria': 'Drograria',
  'netshoes': 'Netshoes',
  'centauro': 'Centauro',
  'renner': 'Renner',
  'riachuelo': 'Riachuelo',
  'zara': 'Zara',
  'nubank': 'Nubank',
  'banco inter': 'Banco Inter',
  'itau': 'Itaú',
  'bradesco': 'Bradesco',
  'santander': 'Santander',
  'caixa economica': 'Caixa',
  'picpay': 'PicPay',
  'booking.com': 'Booking.com',
  'airbnb': 'Airbnb',
  'latam': 'LATAM',
  'gol linhas aereas': 'GOL',
  'azul linhas aereas': 'Azul',
  'localiza': 'Localiza',
  'movida': 'Movida',
  'shell': 'Shell',
  'ipiranga': 'Ipiranga',
  'vivo': 'Vivo',
  'claro': 'Claro',
  'cinemark': 'Cinemark',
  'kalunga': 'Kalunga',
  'steam': 'Steam',
  'playstation': 'PlayStation',
};

// Chaves ordenadas da mais longa pra mais curta — garante que "uber eats"
// seja testado antes de "uber" (evita perder o nome mais específico).
const CHAVES_MARCAS = Object.keys(MARCAS_CONHECIDAS).sort((a, b) => b.length - a.length);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removerPrefixos(texto) {
  for (const re of PREFIXOS_COMUNS) {
    if (re.test(texto)) return texto.replace(re, '');
  }
  return texto;
}

// Remove números de transação/códigos internos e caracteres estranhos:
// asteriscos (comuns em "UBER *TRIP"), sufixos de domínio (.com/.com.br),
// sequências de 2+ dígitos, e pontuação solta usada como separador.
function limparRuido(texto) {
  return texto
    .replace(/\*/g, ' ')
    .replace(/\.(com\.br|com|net|br)\b/gi, '')
    .replace(/\b\d{2,}\b/g, ' ')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function tituloCase(texto) {
  return texto
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function buscarMarcaConhecida(texto) {
  const lower = texto.toLowerCase();
  for (const chave of CHAVES_MARCAS) {
    const re = new RegExp('(^|[^a-z0-9à-ú])' + escapeRegExp(chave) + '($|[^a-z0-9à-ú])', 'i');
    if (re.test(lower)) return MARCAS_CONHECIDAS[chave];
  }
  return null;
}

// Normaliza a descrição crua de uma transação bancária: remove prefixo
// comum, números/códigos e ruído; se reconhecer uma marca conhecida,
// retorna o nome canônico dela; senão, capitaliza o que sobrou.
export function normalizarDescricao(descricao) {
  if (!descricao) return '';
  const semPrefixo = removerPrefixos(descricao.trim());
  const limpo = limparRuido(semPrefixo);
  if (!limpo) return descricao.trim();

  const marca = buscarMarcaConhecida(limpo);
  if (marca) return marca;

  return tituloCase(limpo);
}
