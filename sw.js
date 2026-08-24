const CACHE_NAME = 'eko-financeira-v4'; // v4: modularização (CSS/JS externos)
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  // CSS
  '/assets/css/base.css',
  '/assets/css/components.css',
  '/assets/css/features.css',
  // JS — entry point e fundação
  '/js/main.js',
  '/js/config.js',
  '/js/core/firebase.js',
  '/js/core/store.js',
  '/js/core/router.js',
  '/js/core/theme.js',
  '/js/core/errors.js',
  '/js/utils/format.js',
  '/js/utils/money.js',
  '/js/utils/dom.js',
  '/js/utils/finance-math.js',
  '/js/utils/debounce.js',
  // JS — features
  '/js/features/onboarding.js',
  '/js/features/aulas.js',
  '/js/features/dica-ia.js',
  '/js/features/feedback.js',
  '/js/features/controle.js',
  '/js/features/metas.js',
  '/js/features/dividas.js',
  '/js/features/simulacoes.js',
  '/js/features/reserva.js',
  '/js/features/diagnosticos.js',
  '/js/features/hub.js',
  '/js/features/prontuario.js',
  '/js/features/auth.js',
  '/js/features/push-optin.js',
  // JS — PWA
  '/js/pwa/install-banner.js',
  '/js/pwa/sw-register.js',
  '/js/pwa/onesignal-init.js',
];

// Instala e faz cache dos assets principais
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Limpa caches antigos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Estratégia: network first, fallback para cache
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('firestore') || 
      event.request.url.includes('anthropic') ||
      event.request.url.includes('googleapis') ||
      event.request.url.includes('gstatic.com') ||
      event.request.url.includes('googletagmanager.com')) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ════ PUSH NOTIFICATIONS ════════════════════════════════════

// Recebe notificação push
self.addEventListener('push', event => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch(e) { payload = { title: 'Eko Financeira', body: event.data.text() }; }

  const title = payload.title || 'Eko Financeira 🌱';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    tag: payload.tag || 'eko-notif',
    renotify: true,
    data: { url: payload.url || 'https://app.ekofinanceira.com.br' },
    vibrate: [200, 100, 200],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Clique na notificação — abre o app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || 'https://app.ekofinanceira.com.br';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('ekofinanceira') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
