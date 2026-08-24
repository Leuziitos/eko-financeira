/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — utils/money.js
 * Máscara monetária BRL: parse, máscara de input e binding
 * dinâmico nos campos (setupMoneyInputs).
 *
 * Nota: setupMoneyInputs dispara recálculos chamando funções
 * de features pelo nome global (calcularAposentadoria etc.) —
 * corpo preservado do original; a resolução acontece via
 * window.* em tempo de chamada, dentro de try/catch.
 * ═══════════════════════════════════════════════════════════ */

export function parseMoney(str) {
  if (typeof str === 'number') return str;
  // Remove tudo que não é dígito ou vírgula/ponto
  const s = String(str).replace(/[^\d,.]/g, '');
  // Se tem vírgula, trata como separador decimal BR
  if (s.includes(',')) {
    return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  }
  return parseFloat(s) || 0;
}

export function applyMoneyMask(input) {
  let val = input.value.replace(/\D/g, '');
  if (!val) { input.value = ''; return; }
  val = (parseInt(val) / 100).toFixed(2);
  input.value = 'R$ ' + parseFloat(val).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
window.applyMoneyMask = applyMoneyMask;

export function setupMoneyInputs() {
  const ids = [
    'cad-renda','perfil-renda',
    'ap-renda','ap-patrimonio',
    'ac-inicial','ac-aporte',
    'meta-valor','dep-valor',
    'divida-parcela','divida-ja-pago','pag-valor','pag-amort-valor',
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('type','text');
    el.setAttribute('inputmode','numeric');
    el.removeAttribute('min');
    el.oninput = function() {
      const caret = this.selectionStart;
      const prevLen = this.value.length;
      applyMoneyMask(this);
      const diff = this.value.length - prevLen;
      try { this.setSelectionRange(caret + diff, caret + diff); } catch(e){}
      // Dispara recálculos
      if (id.startsWith('ap-')) { try { calcularAposentadoria(); } catch(e){} }
      if (id.startsWith('ac-')) { try { calcularAcumulacao(); } catch(e){} }
      if (id === 'divida-parcela' || id === 'divida-ja-pago') { try { calcularTotalDivida(); } catch(e){} }
    };
    el.onfocus = function() { if (!this.value) this.placeholder = 'R$ 0,00'; };
  });

  // Campos numéricos das simulações que NÃO são dinheiro mas precisam recalcular
  ['ap-idade','ap-idade-aposent','ap-rent','ap-infl','ap-ir'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = () => { try { calcularAposentadoria(); } catch(e){} };
  });
  ['ac-anos','ac-rent','ac-infl','ac-ir'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = () => { try { calcularAcumulacao(); } catch(e){} };
  });
}
