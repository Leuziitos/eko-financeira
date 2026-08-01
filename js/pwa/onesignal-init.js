/* ═══════════════════════════════════════════════════════════
 * Eko Financeira — pwa/onesignal-init.js
 * Init do SDK OneSignal. SCRIPT CLÁSSICO (não é ES Module):
 * carregado SEM defer, logo após a tag do CDN, para que
 * window.OneSignalDeferred exista antes do SDK (deferido) e de
 * main.js executarem — mesma semântica do inline original.
 * O appId é duplicado de js/config.js por necessidade (script
 * clássico não importa módulos) — manter os dois em sincronia.
 * ═══════════════════════════════════════════════════════════ */

window.OneSignalDeferred = window.OneSignalDeferred || [];
OneSignalDeferred.push(async function(OneSignal) {
  await OneSignal.init({
    appId: "c91df304-8d91-4528-bacd-edb75e918fb1",
    safari_web_id: "",
    notifyButton: { enable: false }, // Usamos nosso próprio card de opt-in
    allowLocalhostAsSecureOrigin: true,
  });
});
