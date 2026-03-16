// Importa as ferramentas do Firebase para segundo plano
importScripts("https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js");

// Suas credenciais do Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDdKY_RF0804x0iMp40PjMyS31XuWKmO-8",
    authDomain: "teste66666-fade0.firebaseapp.com",
    projectId: "teste66666-fade0",
    storageBucket: "teste66666-fade0.firebasestorage.app",
    messagingSenderId: "117822974206",
    appId: "1:117822974206:web:455be5577682e885ea9daf"
};

// Inicializa o Firebase no "fundo" do celular
firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Fica escutando as mensagens quando o site está fechado
messaging.onBackgroundMessage((payload) => {
  console.log("Mensagem recebida com o app fechado: ", payload);
  
  const notificationTitle = payload.notification.title || "Nova Mensagem";
  const notificationOptions = {
    body: payload.notification.body || "Você tem uma nova mensagem no Kimorococho!",
    icon: "https://cdn-icons-png.flaticon.com/512/149/149071.png"
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});