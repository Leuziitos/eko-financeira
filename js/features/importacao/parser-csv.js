/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/importacao/parser-csv.js
 * Parser de extratos em CSV — detecta automaticamente o banco de
 * origem pelo cabeçalho das colunas (Nubank; Inter, C6 e Bradesco
 * caem no mapeador genérico por enquanto — sem cabeçalho oficial
 * confirmado, ver commit da Parte 1) e converte para o mesmo
 * formato de transações do parser OFX.
 *
 * Bancos brasileiros exportam CSV de formas bem diferentes — este
 * parser não assume que a linha 1 é o cabeçalho nem que existe só
 * uma tabela por arquivo:
 *   - Texto solto antes/depois da tabela (título, filtro de
 *     período, aviso de data de consulta, linha de "Total") é
 *     ignorado: qualquer linha que não vire uma linha de dado
 *     válida (data reconhecível) nem um novo cabeçalho válido é
 *     descartada silenciosamente.
 *   - Um mesmo arquivo pode ter mais de uma tabela (ex.: Bradesco,
 *     que repete "Últimos Lançamentos" depois da tabela principal)
 *     — cada linha que bate com um cabeçalho válido reinicia o
 *     mapeamento de colunas usado dali pra frente.
 * ═══════════════════════════════════════════════════════════ */

// Regras de exclusão automática (descrição contém, case-insensitive) —
// mesma lista aplicada pelo parser OFX.
const DESCRICOES_IGNORADAS = [/PAGAMENTO\s+FATURA/i, /PGTO\s+FATURA/i, /PAG\s+FATURA/i, /RENDIMENTO/i, /RENDTO/i];

// Linha de marcador de saldo de abertura/fechamento (Bradesco: "COD. LANC.
// 0") — não é uma transação de verdade, não tem Crédito nem Débito.
const MARCADOR_SALDO = /^COD\.?\s*LANC\.?\s*0$/i;

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
  return DESCRICOES_IGNORADAS.some(re => re.test(descricao || '')) || MARCADOR_SALDO.test((descricao || '').trim());
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
// Conta ocorrências no arquivo inteiro, não só na primeira linha — a
// primeira linha de vários bancos (Bradesco, C6) é texto solto que não
// necessariamente reflete o delimitador real da tabela.
function detectarDelimitador(texto) {
  const virgulas = (texto.match(/,/g) || []).length;
  const pontoVirgulas = (texto.match(/;/g) || []).length;
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
// Tentada linha a linha (ver parseCSV) até achar uma que mapeie — não
// assume que o cabeçalho está numa posição fixa do arquivo.
function detectarMapeamento(headerCols) {
  const normalizados = headerCols.map(c => c.trim().toLowerCase());

  // Nubank (fatura de cartão) — formato antigo, com coluna category.
  // Sem exceção de "pagamento recebido/efetuado" aqui — comportamento
  // preservado exatamente como veio da Parte 1.
  if (normalizados.join(',') === 'date,category,title,amount') {
    return {
      banco: 'Nubank', modo: 'valor',
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
      banco: 'Nubank', modo: 'valor',
      idxData: 0, idxCategoria: -1, idxDescricao: 1, idxValor: 2,
      inverterSinal: true,
      excecaoPagamento: true,
    };
  }

  // Genérico — Inter, C6, Bradesco e qualquer outro banco caem aqui: tenta
  // mapear colunas de data/valor/descrição por palavras-chave comuns no
  // cabeçalho.
  const idxData = normalizados.findIndex(c => /data|date/.test(c));
  if (idxData === -1) return null; // sem coluna de data reconhecível — não é um cabeçalho

  // Ordem de preferência: colunas mais específicas ("título"/"histórico",
  // que carregam o nome do estabelecimento/contraparte) antes de colunas
  // mais genéricas ("descrição", que em alguns bancos é só o tipo da
  // operação, ex. "TRANSF ENVIADA PIX" repetido em toda linha). Sempre
  // exclui o índice já usado pela coluna de data — "Data Lançamento" (C6)
  // contém a palavra "lançamento" e bateria com o candidato mais genérico.
  const candidatosDescricao = [/t[ií]tulo/, /hist[oó]rico/, /descri/, /estabelecimento/, /memo/, /lan[çc]amento/];
  let idxDescricao = -1;
  for (const re of candidatosDescricao) {
    idxDescricao = normalizados.findIndex((c, i) => i !== idxData && re.test(c));
    if (idxDescricao !== -1) break;
  }
  if (idxDescricao === -1) return null; // sem coluna de descrição reconhecível

  const idxCategoria = normalizados.findIndex(c => /categ/.test(c));

  // Modo 1: coluna única de valor com sinal (Nubank genérico, Inter, ...).
  const idxValor = normalizados.findIndex(c => /valor|amount|montante/.test(c));
  if (idxValor !== -1) {
    return { banco: null, modo: 'valor', idxData, idxValor, idxDescricao, idxCategoria, inverterSinal: false };
  }

  // Modo 2: colunas separadas de crédito/entrada e débito/saída (Bradesco:
  // "Crédito (R$)"/"Débito (R$)"; C6: "Entrada(R$)"/"Saída(R$)").
  const idxEntrada = normalizados.findIndex(c => /cr[ée]dito|entrada/.test(c));
  const idxSaida = normalizados.findIndex(c => /d[ée]bito|sa[ií]da/.test(c));
  if (idxEntrada === -1 || idxSaida === -1) return null; // não deu pra mapear

  return { banco: null, modo: 'entrada_saida', idxData, idxEntrada, idxSaida, idxDescricao, idxCategoria };
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

// Converte tanto formato BR (milhar '.', decimal ',' — ex. "2.004,18")
// quanto formato US (decimal '.', sem separador de milhar — ex. "385.44"),
// detectando pela presença de vírgula.
function normalizarValorCSV(raw) {
  let s = String(raw || '').trim().replace(/R\$\s?/i, '').replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); // formato BR: milhar '.', decimal ','
  return parseFloat(s) || 0;
}

// Chave de deduplicação intra-arquivo: mesma data + valor + descrição crua
// (case-insensitive) — usada quando o mesmo lançamento aparece em mais de
// uma tabela do arquivo (ex.: Bradesco repete os últimos dias na tabela
// "Últimos Lançamentos").
function chaveDedupInterno(t) {
  return `${t.data}|${t.valor}|${t.descricao.trim().toUpperCase()}`;
}

// Recebe o conteúdo do arquivo CSV já decodificado (string) e retorna o
// array de transações no mesmo formato do parser OFX. Processa o arquivo
// linha a linha: cada linha é testada primeiro como dado (usando o
// mapeamento de colunas ativo), depois — se não for um dado válido — como
// um novo cabeçalho (o que permite mais de uma tabela no mesmo arquivo);
// se não for nenhum dos dois, é descartada (texto solto, filtro, rodapé).
export function parseCSV(texto) {
  const linhas = texto.split(/\r\n|\r|\n/).filter(l => l.trim() !== '');
  if (!linhas.length) return [];

  const delimitador = detectarDelimitador(texto);

  const transacoes = [];
  let mapa = null;
  let tabelaAtual = 0; // incrementa a cada novo cabeçalho reconhecido — ver dedup abaixo

  for (const linha of linhas) {
    const cols = parseLinhaCSV(linha, delimitador);

    if (mapa) {
      const data = normalizarDataCSV(cols[mapa.idxData]);
      if (data) {
        let descricao = cols[mapa.idxDescricao] || '';
        if (deveIgnorar(descricao)) continue;

        const descricaoIOF = normalizarDescricaoIOF(descricao);
        if (descricaoIOF) descricao = descricaoIOF;

        let valor;
        if (mapa.modo === 'entrada_saida') {
          const entrada = normalizarValorCSV(cols[mapa.idxEntrada]);
          const saida = normalizarValorCSV(cols[mapa.idxSaida]);
          valor = entrada - saida;
        } else {
          valor = normalizarValorCSV(cols[mapa.idxValor]);
          if (mapa.inverterSinal && !(mapa.excecaoPagamento && ehPagamentoFaturaNubank(descricao))) valor = -valor;
        }

        const transacao = {
          data,
          valor,
          descricao,
          tipo: valor < 0 ? 'gasto' : 'receita',
          categoriaExtrato: mapa.idxCategoria > -1 ? (cols[mapa.idxCategoria] || '') : '',
          _tabela: tabelaAtual,
        };
        if (precisaRevisar(descricao)) transacao.revisar = true;

        transacoes.push(transacao);
        continue;
      }
    }

    // Não foi um dado válido (ou ainda não há mapeamento ativo) — tenta
    // reconhecer esta linha como um (novo) cabeçalho.
    const possivelMapa = detectarMapeamento(cols);
    if (possivelMapa) { mapa = possivelMapa; tabelaAtual++; }
    // Nem dado nem cabeçalho: texto solto, filtro de período, aviso,
    // linha de "Total" etc — ignorada silenciosamente.
  }

  // Dedup só entre tabelas diferentes do mesmo arquivo (ex.: Bradesco
  // repete os últimos lançamentos numa segunda tabela) — duas transações
  // reais distintas que coincidem em data+valor+descrição dentro da MESMA
  // tabela (ex.: dois PIX recebidos de mesmo valor no mesmo dia, de
  // pessoas diferentes) não são mexidas, só a repetição entre tabelas é.
  const tabelaPorChave = new Map();
  const resultado = [];
  for (const t of transacoes) {
    const chave = chaveDedupInterno(t);
    const tabelaAnterior = tabelaPorChave.get(chave);
    if (tabelaAnterior !== undefined && tabelaAnterior !== t._tabela) continue;
    if (tabelaAnterior === undefined) tabelaPorChave.set(chave, t._tabela);
    const { _tabela, ...limpo } = t;
    resultado.push(limpo);
  }
  return resultado;
}
