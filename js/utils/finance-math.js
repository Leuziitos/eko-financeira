/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — utils/finance-math.js
 * Matemática financeira pura: PMT, FV, taxa real (Fisher) e
 * IR sobre juros. Sem DOM, sem estado — candidato natural a
 * testes unitários.
 *
 * NOTA: calcPMT e calcPMTparaFV são quase idênticas — duplicação
 * herdada do monólito, preservada de propósito nesta fase
 * (calcPMT: objetivos · calcPMTparaFV: simulações). Unificar
 * apenas em refactor futuro com testes cobrindo ambas.
 * ═══════════════════════════════════════════════════════════ */

export function calcPMT(pv, fv, i, n) {
  if(!n || n <= 0) return 0;
  if(!i || i === 0) return Math.max(0, (fv - pv) / n);
  const fator = Math.pow(1 + i, n);
  const result = (fv - pv * fator) * i / (fator - 1);
  return Math.max(0, result);
}

// Taxa real: desconta inflação mensalmente (Fisher)
export function taxaReal(rent, infl) {
  return (1 + rent/100) / (1 + infl/100) - 1;
}

// FV de uma série de aportes mensais + PV inicial
export function calcFV(pv, pmt, r, n) {
  if (Math.abs(r) < 1e-10) return pv + pmt * n;
  return pv * Math.pow(1+r, n) + pmt * (Math.pow(1+r, n) - 1) / r;
}

// PMT para atingir FV partindo de PV
export function calcPMTparaFV(fv, pv, r, n) {
  if (Math.abs(r) < 1e-10) return Math.max(0, (fv - pv) / n);
  const fator = Math.pow(1+r, n);
  return Math.max(0, (fv - pv * fator) / ((fator - 1) / r));
}

// Lucro líquido após IR (IR só sobre os juros)
export function lucroLiquido(bruto, investido, aliqIR) {
  const juros = Math.max(0, bruto - investido);
  const ir = juros * (aliqIR / 100);
  return bruto - ir;
}

export function irSobreJuros(bruto, investido, aliqIR) {
  return Math.max(0, bruto - investido) * (aliqIR / 100);
}
