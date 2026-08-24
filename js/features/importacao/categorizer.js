/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/importacao/categorizer.js
 * Sugestão automática de categoria do Controle Financeiro para
 * cada transação importada, em 3 camadas (da mais barata/certeira
 * pra mais cara): cache local aprendido → categoria do extrato do
 * banco → IA (Netlify Function → Claude Haiku), só para o que
 * sobrar. DOM-agnóstico: quem atualiza a barra de progresso na
 * tela é importacao.js, via callback onProgresso(atual, total).
 * ═══════════════════════════════════════════════════════════ */

import { getCFCategorias } from '../controle.js';

const CAT_APRENDIDA_KEY = 'eko_cat_aprendida';
const TAMANHO_LOTE_IA = 50;

// ── Camada 1: cache local de categorias já aprendidas ────────
// Estrutura em localStorage: { "mcdonalds": "alimentacao", "uber": "transporte" }
function getMapaAprendido() {
  try { return JSON.parse(localStorage.getItem(CAT_APRENDIDA_KEY)) || {}; } catch(e) { return {}; }
}

export function getCatAprendida(descricaoNormalizada) {
  const chave = (descricaoNormalizada || '').trim().toLowerCase();
  if (!chave) return null;
  return getMapaAprendido()[chave] || null;
}

export function salvarCatAprendida(descricaoNormalizada, categoria) {
  const chave = (descricaoNormalizada || '').trim().toLowerCase();
  if (!chave || !categoria) return;
  const mapa = getMapaAprendido();
  mapa[chave] = categoria;
  localStorage.setItem(CAT_APRENDIDA_KEY, JSON.stringify(mapa));
}

// ── Camada 2: categoria do extrato do banco ───────────────────
// Best-effort — cobre só os valores mais comuns vistos em extratos (ex.: a
// coluna 'category' do CSV do Nubank). O que não bate aqui simplesmente cai
// pra Camada 3 (IA), então um valor não mapeado nunca produz resultado
// errado, só incompleto.
const MAPA_CATEGORIA_EXTRATO_GASTO = {
  food: 'alimentacao', restaurant: 'alimentacao', grocery: 'alimentacao', supermarket: 'alimentacao',
  transport: 'transporte', uber: 'transporte', taxi: 'transporte',
  health: 'saude', pharmacy: 'saude',
  education: 'educacao',
  entertainment: 'lazer', leisure: 'lazer',
  shopping: 'compras',
  beauty: 'beleza',
  travel: 'viagem',
  services: 'servicos',
  home: 'moradia', housing: 'moradia',
  taxes: 'impostos',
  business: 'empreendimento',
};

const MAPA_CATEGORIA_EXTRATO_RECEITA = {
  income: 'salario',
  salary: 'salario',
  investment: 'investimentos',
  investments: 'investimentos',
  freelance: 'freelance',
};

function mapearCategoriaExtrato(categoriaExtrato, tipo, idsValidos) {
  if (!categoriaExtrato) return null;
  const chave = categoriaExtrato.trim().toLowerCase();
  const mapa = tipo === 'receita' ? MAPA_CATEGORIA_EXTRATO_RECEITA : MAPA_CATEGORIA_EXTRATO_GASTO;
  const id = mapa[chave];
  return id && idsValidos.includes(id) ? id : null;
}

// ── Camada 3: IA (Netlify Function → Claude Haiku) ────────────
// Nomes retornados pela IA (ela escolhe a partir do prompt em
// netlify/functions/categorizar.js) → id de categoria do Eko (mesmos ids de
// CF_CATS_PADRAO em controle.js). O prompt só lista as 16 categorias de
// gasto — uma transação de receita que chegue até aqui não tem como
// receber um nome reconhecido e cai no fallback padrão (ver
// categorizarTransacoes), o que é seguro mas não ideal; receitas raramente
// chegam à Camada 3 na prática (PIX/salário costumam bater nas camadas 1/2
// ou já vir com descrição óbvia).
const NOME_PARA_ID_GASTO = {
  'moradia': 'moradia',
  'alimentação': 'alimentacao', 'alimentacao': 'alimentacao',
  'transporte': 'transporte',
  'saúde': 'saude', 'saude': 'saude',
  'educação': 'educacao', 'educacao': 'educacao',
  'lazer': 'lazer',
  'compras': 'compras',
  'beleza': 'beleza',
  'viagem': 'viagem',
  'serviços': 'servicos', 'servicos': 'servicos',
  'contas fixas': 'contas',
  'impostos': 'impostos',
  'negócio': 'empreendimento', 'negocio': 'empreendimento',
  'metas': 'metas',
  'dívidas': 'dividas', 'dividas': 'dividas',
  'outras': 'outras',
};

function nomeCategoriaParaId(nome) {
  if (!nome) return null;
  return NOME_PARA_ID_GASTO[String(nome).trim().toLowerCase()] || null;
}

// Chama a Netlify Function em lotes de TAMANHO_LOTE_IA descrições únicas,
// reportando progresso via onProgresso(atual, total) a cada lote concluído.
// Retorna um Map<descricaoNormalizada, categoriaId>.
async function categorizarViaIA(descricoesUnicas, onProgresso) {
  const mapa = new Map();
  let processadas = 0;

  for (let i = 0; i < descricoesUnicas.length; i += TAMANHO_LOTE_IA) {
    const lote = descricoesUnicas.slice(i, i + TAMANHO_LOTE_IA);
    try {
      const resposta = await fetch('/.netlify/functions/categorizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descricoes: lote }),
      });
      const data = await resposta.json();
      (data.sugestoes || []).forEach(s => {
        const id = nomeCategoriaParaId(s.categoria);
        if (id) mapa.set(s.descricao, id);
      });
    } catch(e) {
      console.error('categorizarViaIA:', e); // segue sem sugestão pra esse lote — cai no fallback padrão
    }
    processadas += lote.length;
    if (typeof onProgresso === 'function') {
      try { onProgresso(Math.min(processadas, descricoesUnicas.length), descricoesUnicas.length); } catch(e){}
    }
  }

  return mapa;
}

// ── Orquestração das 3 camadas ────────────────────────────────
// Recebe as transações já normalizadas (com descricaoNormalizada
// preenchida — ver normalizer.js) e retorna elas de volta com 'categoria'
// (id válido para o usuário atual) e 'origemCategoria' ('aprendida' |
// 'extrato' | 'ia' | 'padrao') preenchidos.
export async function categorizarTransacoes(transacoes, onProgresso) {
  const cats = await getCFCategorias();
  const idsGasto = (cats.gasto || []).map(c => c.id);
  const idsReceita = (cats.receita || []).map(c => c.id);
  const idsPara = tipo => tipo === 'receita' ? idsReceita : idsGasto;

  const pendentes = [];
  let resultado = transacoes.map(t => {
    const idsValidos = idsPara(t.tipo);

    const aprendida = getCatAprendida(t.descricaoNormalizada);
    if (aprendida && idsValidos.includes(aprendida)) {
      return { ...t, categoria: aprendida, origemCategoria: 'aprendida' };
    }

    const doExtrato = mapearCategoriaExtrato(t.categoriaExtrato, t.tipo, idsValidos);
    if (doExtrato) return { ...t, categoria: doExtrato, origemCategoria: 'extrato' };

    pendentes.push(t);
    return t; // categoria ainda não definida — resolvida abaixo (Camada 3)
  });

  if (pendentes.length) {
    const descricoesUnicas = [...new Set(pendentes.map(t => t.descricaoNormalizada))];
    const sugestoes = await categorizarViaIA(descricoesUnicas, onProgresso);

    resultado = resultado.map(t => {
      if (t.categoria) return t; // já resolvido nas camadas 1/2
      const idsValidos = idsPara(t.tipo);
      const sugerida = sugestoes.get(t.descricaoNormalizada);
      if (sugerida && idsValidos.includes(sugerida)) {
        return { ...t, categoria: sugerida, origemCategoria: 'ia' };
      }
      const padrao = t.tipo === 'receita' ? 'outros-rec' : 'outras';
      return { ...t, categoria: idsValidos.includes(padrao) ? padrao : (idsValidos[0] || padrao), origemCategoria: 'padrao' };
    });
  }

  return resultado;
}
