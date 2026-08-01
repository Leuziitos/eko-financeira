/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — pwa/install-banner.js
 * Banner de instalação do PWA: Android via beforeinstallprompt
 * (prompt nativo), iOS via instrução manual com timer. Cooldown
 * de 7 dias após dispensa. Autocontido (sem imports).
 * Corpo movido verbatim do monólito.
 * ═══════════════════════════════════════════════════════════ */

let _deferredPrompt = null;

// Android — captura o evento de instalação nativo
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredPrompt = e;
  mostrarBannerPWA('android');
});

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isEmStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
}

function mostrarBannerPWA(plataforma) {
  // Não mostra se já instalou ou se já dispensou
  if (isEmStandalone()) return;
  if (localStorage.getItem('eko_pwa_dispensado')) return;

  const banner = document.getElementById('pwa-banner');
  const instrucao = document.getElementById('pwa-banner-instrucao');
  const btnInstalar = document.getElementById('pwa-btn-instalar');

  if (!banner) return;

  if (plataforma === 'ios') {
    instrucao.textContent = 'Toque em ⬆️ compartilhar → "Adicionar à Tela de Início"';
    btnInstalar.style.display = 'none'; // iOS não tem instalação direta
  } else {
    instrucao.textContent = 'Adicione à tela inicial e use como um app nativo!';
    btnInstalar.style.display = '';
    btnInstalar.onclick = async () => {
      if (_deferredPrompt) {
        _deferredPrompt.prompt();
        const result = await _deferredPrompt.userChoice;
        if (result.outcome === 'accepted') {
          localStorage.setItem('eko_pwa_dispensado', '1');
          banner.style.display = 'none';
        }
        _deferredPrompt = null;
      }
    };
  }

  // Mostra o banner com pequeno delay
  setTimeout(() => { banner.style.display = ''; }, 2000);
}

window.fecharBannerPWA = function() {
  document.getElementById('pwa-banner').style.display = 'none';
  // Não mostra novamente por 7 dias
  localStorage.setItem('eko_pwa_dispensado', Date.now().toString());
};

// iOS — mostra banner após 3 segundos se não estiver instalado
if (isIOS() && !isEmStandalone()) {
  const dispensado = localStorage.getItem('eko_pwa_dispensado');
  const seteDias = 7 * 24 * 60 * 60 * 1000;
  if (!dispensado || (Date.now() - parseInt(dispensado)) > seteDias) {
    setTimeout(() => mostrarBannerPWA('ios'), 3000);
  }
}
