importScripts('https://www.gstatic.com/firebasejs/11.0.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAu5cMIkf6zn6sTt3M5eTV5uoPE002ad2k",
  authDomain: "eko-financeira.firebaseapp.com",
  projectId: "eko-financeira",
  storageBucket: "eko-financeira.firebasestorage.app",
  messagingSenderId: "600120589786",
  appId: "1:600120589786:web:b71b059b58b15caae4d4e3",
  measurementId: "G-ZJBF8CPZ9R"
});

const messaging = firebase.messaging();

// Receber notificação com app em background
messaging.onBackgroundMessage(payload => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || 'Eko Financeira 🌱', {
    body: body || '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    tag: 'eko-notif',
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: 'https://app.ekofinanceira.com.br' }
  });
});

// Clique na notificação
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('ekofinanceira') && 'focus' in client) return client.focus();
      }
      return clients.openWindow('https://app.ekofinanceira.com.br');
    })
  );
});
