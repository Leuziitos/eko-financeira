/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — features/planilha.js
 * Módulo Planilha Excel: navegação e links externos
 * (Google Drive / YouTube). Corpo movido verbatim.
 * baixarPlanilha/abrirVideo preservados (não referenciados
 * pelo HTML atual — código herdado do monólito).
 * ═══════════════════════════════════════════════════════════ */

import { ir } from '../core/router.js';
import { toast } from '../utils/dom.js';

window.abrirPlanilha = function() { ir('screen-planilha'); };

window.baixarPlanilha = function() {
  // Link direto para planilha PEF no Google Drive / site
  const url = 'https://ekofinanceira.com.br/planilha'; // Atualizar com URL real
  window.open(url, '_blank');
  toast('📥 Abrindo link de download...');
};

window.abrirVideo = function(tipo) {
  let url = '';
  if (tipo === 'planilha') url = 'https://youtube.com/@ekofinanceira'; // Atualizar com URL real
  else url = 'https://youtube.com/@ekofinanceira';
  window.open(url, '_blank');
};
