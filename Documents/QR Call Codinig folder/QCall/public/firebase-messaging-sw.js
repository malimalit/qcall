importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAqSil0vbir0TklpqAORr5ZIh6RKbwmtZk",
  authDomain: "qcall-e1ec9.firebaseapp.com",
  projectId: "qcall-e1ec9",
  storageBucket: "qcall-e1ec9.firebasestorage.app",
  messagingSenderId: "775125377549",
  appId: "1:775125377549:web:1de5c4eb8c706bf7fceb44"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/favicon.ico',
    requireInteraction: true
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});