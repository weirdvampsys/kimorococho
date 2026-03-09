<!DOCTYPE html>
<html>
<head>
  
  <meta charset="UTF-8">
  <title>Chat Privado</title>
  <script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js"></script>
  <style>
    body { font-family: Arial; background:#111; color:white; }
    .box { max-width:400px; margin:auto; margin-top:50px; }
    input { width:100%; padding:10px; margin:5px 0; }
    button { padding:10px; width:100%; background:#00bcd4; border:none; color:white; }
    #chat { display:none; }
    #messages { height:300px; overflow:auto; background:#222; padding:10px; }
  </style>
</head>
<body>

<div class="box" id="login">
  <h2>Login</h2>
  <input type="text" id="username" placeholder="Username">
  <input type="password" id="password" placeholder="Senha">
  <button onclick="register()">Registrar</button>
  <button onclick="login()">Entrar</button>
</div>

<div class="box" id="chat">
  <h2>Chat</h2>
  <div id="messages"></div>
  <input type="text" id="msg" placeholder="Digite mensagem">
  <button onclick="sendMessage()">Enviar</button>
</div>

<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
  import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
  import { getFirestore, collection, addDoc, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

  const firebaseConfig = {
    apiKey: "SUA_API_KEY",
    authDomain: "SEU_AUTH_DOMAIN",
    projectId: "SEU_PROJECT_ID",
  };

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  window.register = async function() {
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const fakeEmail = username + "@chat.com";

    await createUserWithEmailAndPassword(auth, fakeEmail, password);
    alert("Registrado!");
  }

  window.login = async function() {
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const fakeEmail = username + "@chat.com";

    await signInWithEmailAndPassword(auth, fakeEmail, password);
    document.getElementById("login").style.display = "none";
    document.getElementById("chat").style.display = "block";
    loadMessages();
  }

  window.sendMessage = async function() {
    const text = document.getElementById("msg").value;
    await addDoc(collection(db, "messages"), {
      text: text,
      user: auth.currentUser.email,
      created: Date.now()
    });
    document.getElementById("msg").value = "";
  }

  function loadMessages() {
    const q = query(collection(db, "messages"), orderBy("created"));
    onSnapshot(q, (snapshot) => {
      const messagesDiv = document.getElementById("messages");
      messagesDiv.innerHTML = "";
      snapshot.forEach((doc) => {
        const data = doc.data();
        messagesDiv.innerHTML += `<p><b>${data.user}</b>: ${data.text}</p>`;
      });
    });
  }
</script>

</body>
</html>