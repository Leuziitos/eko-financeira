/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/importacao/parser-ofx.js
 * Parser de extratos no formato OFX (SGML — padrão brasileiro —
 * e XML), com detecção automática de encoding (UTF-8 / ISO-8859-1
 * via TextDecoder). Converte o arquivo num array de transações
 * no mesmo formato produzido pelo parser CSV.
 *
 * SGML (OFX 1.x) não fecha tags de campo folha (ex.: <DTPOSTED>
 * sem </DTPOSTED>, valor termina na próxima tag ou quebra de
 * linha); XML (OFX 2.x) fecha todas as tags. getTagValue() lê os
 * dois formatos com a mesma regra: captura tudo após a tag de
 * abertura até o próximo '<' (ou fim da linha) — funciona igual
 * nos dois casos sem precisar de um parser SGML/XML completo.
 * ═══════════════════════════════════════════════════════════ */

// Regras de exclusão automática (descrição contém, case-insensitive) —
// mesma lista aplicada pelo parser CSV.
const DESCRICOES_IGNORADAS = [/PAGAMENTO\s+FATURA/i, /PGTO\s+FATURA/i, /PAG\s+FATURA/i, /RENDIMENTO/i, /RENDTO/i];

// Regras de sinalização para revisão manual — mesma lista do parser CSV.
function precisaRevisar(descricao) {
  const d = (descricao || '').toUpperCase();
  if (/PIX\s+RECEBID/.test(d)) return true;
  if (/TED\s+RECEBID/.test(d)) return true;
  if (/TRANSFER[ÊE]NCIA\s+RECEBID/.test(d)) return true;
  if (/\d+\s*\/\s*\d+/.test(d)) return true; // padrão de parcelamento, ex.: "1/12"
  return false;
}

function deveIgnorar(descricao) {
  return DESCRICOES_IGNORADAS.some(re => re.test(descricao || ''));
}

// DTPOSTED vem como "20240715120000[-3:BRT]" ou só "20240715" — os
// primeiros 8 dígitos são sempre AAAAMMDD.
function formatarDataOFX(raw) {
  const m = (raw || '').match(/(\d{4})(\d{2})(\d{2})/);
  if (!m) return '';
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function parseValorOFX(raw) {
  if (!raw) return 0;
  // OFX usa ponto decimal, mas alguns exports BR usam vírgula — trata os dois
  const limpo = String(raw).trim().replace(/\.(?=\d{3}(?:,|$))/g, '').replace(',', '.');
  return parseFloat(limpo) || 0;
}

function getTagValue(bloco, tag) {
  const re = new RegExp('<' + tag + '>\\s*([^<\\r\\n]*)', 'i');
  const m = bloco.match(re);
  return m ? m[1].trim() : '';
}

// Recebe o conteúdo do arquivo OFX já decodificado (string) e retorna o
// array de transações. Não lida com encoding — ver decodificarArquivoOFX().
export function parseOFX(texto) {
  const blocos = texto.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
  const transacoes = [];

  blocos.forEach(bloco => {
    const dataRaw = getTagValue(bloco, 'DTPOSTED');
    const valorRaw = getTagValue(bloco, 'TRNAMT');
    const descricao = getTagValue(bloco, 'MEMO') || getTagValue(bloco, 'NAME') || '';
    const categoriaExtrato = getTagValue(bloco, 'CATEGORY');

    if (deveIgnorar(descricao)) return;

    const valor = parseValorOFX(valorRaw);
    const data = formatarDataOFX(dataRaw);
    if (!data) return; // linha sem data válida — não é uma transação utilizável

    const transacao = {
      data,
      valor,
      descricao,
      tipo: valor < 0 ? 'gasto' : 'receita',
      categoriaExtrato,
    };
    if (precisaRevisar(descricao)) transacao.revisar = true;

    transacoes.push(transacao);
  });

  return transacoes;
}

// Extrai a tag <ORG> (identificador da instituição financeira, campo padrão
// do cabeçalho OFX/SONRS) quando presente — usado por detectarFonte() em
// importacao.js para diferenciar bancos em arquivos OFX, que ao contrário
// do CSV não têm cabeçalho de colunas próprio.
export function extrairOrgOFX(texto) {
  const m = texto.match(/<ORG>\s*([^<\r\n]*)/i);
  return m ? m[1].trim() : '';
}

// O cabeçalho OFX (linhas OFXHEADER/DATA/ENCODING/CHARSET antes do <OFX>) é
// sempre ASCII puro — decodificar um trecho inicial como latin1 (mapeamento
// 1:1 byte↔código, nunca lança erro, seguro só pra ler ASCII) é suficiente
// pra ler o CHARSET declarado sem precisar adivinhar o encoding do arquivo
// inteiro primeiro.
function lerCharsetDeclarado(arrayBuffer) {
  const tamanho = Math.min(arrayBuffer.byteLength, 512);
  const cabecalho = new TextDecoder('iso-8859-1').decode(arrayBuffer.slice(0, tamanho));
  const m = cabecalho.match(/CHARSET\s*:\s*(\S+)/i);
  return m ? m[1].trim() : '';
}

// Decodifica o ArrayBuffer do arquivo. Primeiro lê o CHARSET declarado no
// cabeçalho OFX: se for 1252 (Windows-1252 — comum em extratos de bancos
// brasileiros, incluindo o Nubank), decodifica direto como windows-1252, em
// vez de depender de heurística. Sem CHARSET:1252 declarado, cai pro
// comportamento herdado: tenta UTF-8 (modo estrito — lança erro em
// sequência de bytes inválida) e, se falhar, usa ISO-8859-1 — que pelo
// WHATWG Encoding Standard já é tratado como alias de Windows-1252 pelo
// TextDecoder (não é o ISO-8859-1 "puro"), então cobre o mesmo caso na
// prática, só que só entra em ação quando o UTF-8 estrito falha.
// Uso: o fluxo de seleção de arquivo (importacao.js) lê o File como
// ArrayBuffer, chama esta função para obter a string, e só então passa o
// resultado para parseOFX(texto).
export function decodificarArquivoOFX(arrayBuffer) {
  const charset = lerCharsetDeclarado(arrayBuffer);
  if (charset === '1252') {
    try { return new TextDecoder('windows-1252').decode(arrayBuffer); }
    catch(e) { /* encoding não suportado — segue pro fallback abaixo */ }
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(arrayBuffer);
  } catch (e) {
    return new TextDecoder('iso-8859-1').decode(arrayBuffer);
  }
}
