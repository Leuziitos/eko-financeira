/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/importacao/parser-csv.js
 * Parser de extratos em CSV — detecta automaticamente o banco de
 * origem pelo cabeçalho das colunas (Nubank; Inter e C6 caem no
 * mapeador genérico por enquanto — sem cabeçalho oficial
 * confirmado, ver commit da Parte 1) e converte para o mesmo
 * formato de transações do parser OFX.
 * ═══════════════════════════════════════════════════════════ */

// Regras de exclusão automática (descrição contém, case-insensitive) —
// mesma lista aplicada pelo parser OFX.
const DESCRICOES_IGNORADAS = [/PAGAMENTO\s+FATURA/i, /PGTO\s+FATURA/i, /PAG\s+FATURA/i, /RENDIMENTO/i, /RENDTO/i];

// Regras de sinalização para revisão manual — mesma lista do parser OFX.
function precisaRevisar(descricao) {
  const d = (descricao || '').toUpperCase();
  if (/PIX\s+RECEBID/.test(d)) return true;
  if (/TED\s+RECEBID/.test(d)) return true;
  if (/TRANSFER[ÊE]NCIA\s+RECEBID/.test(d)) return true;
  if (/\d+\s*\/\s*\d+/.test(d)) return true; // padrão de parcelamento, ex.: "1/12"
  if (/^IOF\b/.test(d)) return true; // IOF vinculado a uma compra — revisar antes de aprovar
  return false;
}

function deveIgnorar(descricao) {
  return DESCRICOES_IGNORADAS.some(re => re.test(descricao || ''));
}

// Linhas "Pagamento recebido"/"Pagamento efetuado" na fatura de cartão do
// Nubank são crédito (reduzem a fatura) — mesmo vindo com valor bruto
// positivo igual as compras, não devem ser invertidas pro sinal negativo.
function ehPagamentoFaturaNubank(descricao) {
  return /pagamento\s+recebido/i.test(descricao || '') || /pagamento\s+efetuado/i.test(descricao || '');
}

// Linha de IOF vinculada à compra anterior (ex.: título "IOF Netlify",
// "IOF - Netlify", "IOF de Netlify") — não é filtrada (mesma decisão já
// tomada pra IOF na Parte 1: não descartar), mas ganha descrição limpa
// "IOF - <estabelecimento>" pra ficar clara na revisão, além do flag
// revisar (ver precisaRevisar).
function normalizarDescricaoIOF(descricao) {
  const m = (descricao || '').match(/^IOF\b[\s\-:]*\s*(?:de\s+)?(.*)$/i);
  if (!m) return null;
  const estabelecimento = (m[1] || '').trim();
  return estabelecimento ? `IOF - ${estabelecimento}` : 'IOF';
}

// ── CSV parsing (delimitador , ou ; · respeita campos entre aspas) ───────
function detectarDelimitador(linhaHeader) {
  const virgulas = (linhaHeader.match(/,/g) || []).length;
  const pontoVirgulas = (linhaHeader.match(/;/g) || []).length;
  return pontoVirgulas > virgulas ? ';' : ',';
}

function parseLinhaCSV(linha, delimitador) {
  const campos = [];
  let atual = '';
  let dentroAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentroAspas && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentroAspas = !dentroAspas;
    } else if (c === delimitador && !dentroAspas) {
      campos.push(atual.trim());
      atual = '';
    } else {
      atual += c;
    }
  }
  campos.push(atual.trim());
  return campos;
}

// ── Detecção de banco pelo cabeçalho ─────────────────────────────────────
function detectarMapeamento(headerCols) {
  const normalizados = headerCols.map(c => c.trim().toLowerCase());

  // Nubank (fatura de cartão) — formato antigo, com coluna category.
  // Sem exceção de "pagamento recebido/efetuado" aqui — comportamento
  // preservado exatamente como veio da Parte 1.
  if (normalizados.join(',') === 'date,category,title,amount') {
    return {
      banco: 'Nubank',
      idxData: 0, idxCategoria: 1, idxDescricao: 2, idxValor: 3,
      inverterSinal: true, // export do Nubank: amount positivo = compra (gasto); ver Parte 1
      excecaoPagamento: false,
    };
  }

  // Nubank (fatura de cartão) — formato novo, sem coluna category. Aqui sim
  // "Pagamento recebido"/"Pagamento efetuado" ficam de fora da inversão de
  // sinal (ver ehPagamentoFaturaNubank) — comportamento confirmado só pra
  // este formato.
  if (normalizados.join(',') === 'date,title,amount') {
    return {
      banco: 'Nubank',
      idxData: 0, idxCategoria: -1, idxDescricao: 1, idxValor: 2,
      inverterSinal: true,
      excecaoPagamento: true,
    };
  }

  // Genérico — Inter, C6 e qualquer outro banco caem aqui: tenta mapear
  // colunas de data/valor/descrição por palavras-chave comuns no cabeçalho.
  const idxData = normalizados.findIndex(c => /data|date/.test(c));
  const idxValor = normalizados.findIndex(c => /valor|amount|montante/.test(c));
  const idxDescricao = normalizados.findIndex(c => /descri|title|hist[oó]rico|lan[çc]amento|estabelecimento|memo/.test(c));
  const idxCategoria = normalizados.findIndex(c => /categ/.test(c));

  if (idxData === -1 || idxValor === -1 || idxDescricao === -1) return null; // não deu pra mapear

  return { banco: null, idxData, idxValor, idxDescricao, idxCategoria, inverterSinal: false };
}

// ── Normalização de data e valor ─────────────────────────────────────────
function normalizarDataCSV(raw) {
  raw = (raw || '').trim();
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/); // ISO: AAAA-MM-DD
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // BR: DD/MM/AAAA ou DD/MM/AA
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return '';
}

function normalizarValorCSV(raw) {
  let s = String(raw || '').trim().replace(/R\$\s?/i, '').replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); // formato BR: milhar '.', decimal ','
  return parseFloat(s) || 0;
}

// Recebe o conteúdo do arquivo CSV já decodificado (string) e retorna o
// array de transações no mesmo formato do parser OFX.
export function parseCSV(texto) {
  const linhas = texto.split(/\r\n|\r|\n/).filter(l => l.trim() !== '');
  if (!linhas.length) return [];

  const delimitador = detectarDelimitador(linhas[0]);
  const headerCols = parseLinhaCSV(linhas[0], delimitador);
  const mapa = detectarMapeamento(headerCols);
  if (!mapa) return []; // cabeçalho não reconhecido — nenhuma coluna essencial identificada

  const transacoes = [];
  for (let i = 1; i < linhas.length; i++) {
    const cols = parseLinhaCSV(linhas[i], delimitador);
    let descricao = cols[mapa.idxDescricao] || '';
    if (deveIgnorar(descricao)) continue;

    const descricaoIOF = normalizarDescricaoIOF(descricao);
    if (descricaoIOF) descricao = descricaoIOF;

    let valor = normalizarValorCSV(cols[mapa.idxValor]);
    if (mapa.inverterSinal && !(mapa.excecaoPagamento && ehPagamentoFaturaNubank(descricao))) valor = -valor;
    const data = normalizarDataCSV(cols[mapa.idxData]);
    if (!data) continue; // linha sem data válida — não é uma transação utilizável

    const transacao = {
      data,
      valor,
      descricao,
      tipo: valor < 0 ? 'gasto' : 'receita',
      categoriaExtrato: mapa.idxCategoria > -1 ? (cols[mapa.idxCategoria] || '') : '',
    };
    if (precisaRevisar(descricao)) transacao.revisar = true;

    transacoes.push(transacao);
  }

  return transacoes;
}
