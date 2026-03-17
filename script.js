// 1. IMPORTS (Sempre no topo) - FIX 3: updateEmail importado
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, get, set, update, push, onValue, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut, updatePassword, onAuthStateChanged, updateEmail } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getStorage, ref as sRef, uploadBytes, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
// Adicione o import do Messaging se não tiver
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";

// 2. CONFIGURAÇÃO
const firebaseConfig = {
  apiKey: "AIzaSyCJfo84IuIDzRDjgh1QE97kA2LDpwLmiTY",
  authDomain: "kimorococho-4f979.firebaseapp.com",
  projectId: "kimorococho-4f979",
  storageBucket: "kimorococho-4f979.firebasestorage.app",
  messagingSenderId: "810027921225",
  appId: "1:810027921225:web:c8dee1c7337e70f43bf498"
};


const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);        
const storage = getStorage(app); 
const messaging = getMessaging(app);

const DEFAULT_AVATAR = "https://cdn-icons-png.flaticon.com/512/149/149071.png";

let currentUser = null;
let activeChatId = null;
let isGroup = false;

let chatUnsubscribe = null;
let statusUnsubscribe = null; 
let typingUnsubscribe = null;
let dmsChatsUnsubscribe = null;
let groupsChatsUnsubscribe = null;

let cropperInstance = null;
let currentCropType = 'profile'; 
let typingTimeout;
let mediaRecorder;
let audioChunks = [];
let respondendoMensagem = null;

const campoTexto = document.getElementById("messageInput");
const iconeBotao = document.getElementById("actionIcon");

function limparListenersChat() {
    if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
    if (statusUnsubscribe) { statusUnsubscribe(); statusUnsubscribe = null; }
    if (typingUnsubscribe) { typingUnsubscribe(); typingUnsubscribe = null; }
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./firebase-messaging-sw.js')
        .catch((err) => console.error('Falha ao registrar SW:', err));
}

// FIX 7: AVISOS DE ERRO E SITE FORA DO AR GLOBAL (CORRIGIDO)

const connectedRef = ref(db, ".info/connected");
let timeoutConexao; // Criamos uma variável para guardar o cronômetro

onValue(connectedRef, (snap) => {
    const banner = document.getElementById('system-error-banner');
    if(!banner) return;
    
    if (snap.val() === true) {
        // Conectou! Limpa qualquer alarme de erro e esconde o banner
        clearTimeout(timeoutConexao);
        banner.style.display = 'none';
    } else {
        // Está desconectado ou carregando. Limpa cronômetros antigos por garantia...
        clearTimeout(timeoutConexao); 
        
        // ...e inicia um novo cronômetro de 3 segundos
        timeoutConexao = setTimeout(() => { 
            // Se passou 3 segundos e não recebeu o "true" lá de cima, exibe o erro
            banner.style.display = 'block'; 
        }, 3000); 
    }
});

window.apagarMensagem = (key) => { if(confirm("Apagar mensagem?")) remove(ref(db, `chats/${activeChatId}/${key}`)); };

window.prepararResposta = (texto, autor) => {
    respondendoMensagem = { texto, autor };
    const divResposta = document.getElementById("reply-preview");
    if(divResposta) {
        divResposta.style.display = "flex";
        // FIX 2: max-width para evitar ultrapassar a tela
        divResposta.innerHTML = `
            <div style="border-left: 4px solid var(--primary); padding-left: 10px; background: rgba(0,0,0,0.1); flex: 1; min-width: 0; border-radius: 4px; text-align: left; max-width: 100%; overflow: hidden;">
                <small style="color: var(--primary); font-weight: bold; display: block;">${autor}</small>
                <p style="margin: 0; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text); width: 100%;">
                    ${texto}
                </p>
            </div>
            <button onclick="cancelarResposta()" style="background:none; color:var(--danger); padding: 10px; margin-left: 5px; border:none; cursor:pointer; font-weight:bold; flex-shrink: 0;">✕</button>
        `;
    }
};

window.cancelarResposta = () => {
    respondendoMensagem = null;
    const div = document.getElementById("reply-preview");
    if(div) div.style.display = "none";
};

window.promoverRebaixar = async (membro, isJaAdmin) => {
    if (isJaAdmin) { if(confirm(`Tirar admin de ${membro}?`)) await remove(ref(db, `groups/${activeChatId}/admins/${membro}`)); } 
    else { if(confirm(`Dar admin para ${membro}?`)) await update(ref(db, `groups/${activeChatId}/admins`), { [membro]: true }); }
};

window.removerDoGrupo = async (membro) => {
    if(confirm(`Expulsar ${membro} do grupo?`)) {
        await remove(ref(db, `groups/${activeChatId}/members/${membro}`));
        await remove(ref(db, `groups/${activeChatId}/admins/${membro}`));
    }
};

window.openFullImage = (src) => {
    const modal = document.getElementById("imageModal");
    const modalImg = document.getElementById("modalImg");
    const downloadBtn = document.getElementById("downloadImageBtn");
    if(!modal || !modalImg || !downloadBtn) return;
    modalImg.src = src; downloadBtn.href = src; modalImg.style.transform = "scale(1)"; modal.style.display = "flex";
};

window.sendFavoriteSticker = async (base64) => {
    if (!activeChatId) return;
    try {
        await push(ref(db, `chats/${activeChatId}`), { sender: currentUser, text: base64, type: 'sticker', timestamp: Date.now(), read: false });
        const favModal = document.getElementById("favoritesModal");
        if(favModal) favModal.style.display = "none";
    } catch (error) { alert("Erro ao enviar figurinha."); }
};

function gerenciarPresenca() {
    if (!currentUser) return;
    const myStatusRef = ref(db, `users/${currentUser}/status`);
    onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
            set(myStatusRef, "online");
            onDisconnect(myStatusRef).set("offline");
        }
    });
}

async function iniciarNotificacoesGlobais() {
    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            const token = await getToken(messaging, { vapidKey: "d9ZGLvN4Md1NiSjS8aX6S59btllHpwwWQD_bWuANB80" });
            if (token && currentUser) await update(ref(db, `users/${currentUser}`), { pushToken: token });
        }
    } catch (error) { console.error("Erro ao configurar push:", error); }
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user.email.replace("@chat.com", "");
        showScreen("profile-screen");
        loadProfile();
        gerenciarPresenca();
        iniciarNotificacoesGlobais();
    } else {
        currentUser = null;
        showScreen("login-screen");
    }
});

const loginBtn = document.getElementById("loginBtn");
if(loginBtn) {
    loginBtn.onclick = async () => {
        const u = document.getElementById("username").value.trim().toLowerCase();
        const p = document.getElementById("password").value.trim();
        try {
            loginBtn.style.transform = "scale(0.95)"; 
            await signInWithEmailAndPassword(auth, u + "@chat.com", p);
        } catch (e) {
            alert("Erro ao logar: " + e.message); 
            window.registrarErroAdmin("Tentativa de Login", e.message);
        } finally { loginBtn.style.transform = "scale(1)"; }
    };
}

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
    logoutBtn.onclick = async () => {
        if (!confirm("Tem certeza que deseja sair?")) return;
        if (currentUser) await set(ref(db, `users/${currentUser}/status`), "offline");
        await signOut(auth);
        location.reload(); 
    };
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => {
        s.style.display = 'none'; s.classList.remove('active-flex');
    });
    const screen = document.getElementById(id);
    if (screen) screen.style.display = 'flex'; 
}

const logarComEnter = (event) => { if (event.key === "Enter") document.getElementById("loginBtn")?.click(); };
const userField = document.getElementById("username");
const passField = document.getElementById("password");
if (userField) userField.addEventListener("keypress", logarComEnter);
if (passField) passField.addEventListener("keypress", logarComEnter);

function loadProfile() {
    onValue(ref(db, "users/" + currentUser), snap => {
        const d = snap.val();
        if (d) {
            document.getElementById("displayUsername").innerText = d.displayName || currentUser;
            document.getElementById("profilePhoto").src = d.photoUrl || DEFAULT_AVATAR;
            if (currentUser === "weirdvampsys") document.getElementById("toggleAdminBtn").style.display = "inline-block";
        }
    });
    loadGroups();
    loadDMs(); 
}

const btnChangePass = document.getElementById("changePasswordBtn");
if (btnChangePass) {
    btnChangePass.onclick = async () => {
        const novaSenha = document.getElementById("newPasswordInput").value.trim();
        if (!currentUser) return alert("Erro: Utilizador não identificado.");
        if (novaSenha.length < 6) return alert("A senha deve ter pelo menos 6 caracteres!");
        try {
            if (auth.currentUser) {
                await updatePassword(auth.currentUser, novaSenha);
                alert("Senha alterada com sucesso!");
                document.getElementById("newPasswordInput").value = "";
                document.getElementById("login-change-section").style.display = "none";
            } else { alert("Erro: Sessão inválida. Tente deslogar e logar novamente."); }
        } catch (e) {
            if (e.code === 'auth/requires-recent-login') alert("Por segurança, saia do aplicativo e faça login novamente antes de mudar a senha.");
            else alert("Erro ao mudar senha: " + e.message);
        }
    };
}

const toggleAdminBtn = document.getElementById("toggleAdminBtn");
if(toggleAdminBtn){
    toggleAdminBtn.onclick = () => {
        const section = document.getElementById("admin-section");
        const isHidden = section.style.display === "none" || section.style.display === "";
        section.style.display = isHidden ? "block" : "none";
        toggleAdminBtn.innerText = isHidden ? "Fechar ADM" : "Sessão ADM";
        toggleAdminBtn.style.background = isHidden ? "var(--danger)" : "var(--primary)";
        if (isHidden) carregarErros();
    };
}

const changeUsernameBtn = document.getElementById("changeUsernameBtn");
if(changeUsernameBtn){
    changeUsernameBtn.onclick = async () => {
        const novoLogin = document.getElementById("newUsernameInput").value.trim().toLowerCase();
        const antigoLogin = currentUser;
        if (!novoLogin || novoLogin === antigoLogin) return alert("Digite um login diferente!");

        try {
            const checkSnap = await get(ref(db, `users/${novoLogin}`));
            if (checkSnap.exists()) return alert("Este login já está em uso!");
            if (!confirm(`Atenção: Vamos mover todas as suas conversas para '${novoLogin}'. Você será deslogado.`)) return;

            // FIX 3: Atualiza o email na auth verdadeira
            if (auth.currentUser) {
                await updateEmail(auth.currentUser, novoLogin + "@chat.com");
            } else {
                return alert("Erro de segurança. Saia e entre novamente para alterar o login.");
            }

            const userSnap = await get(ref(db, `users/${antigoLogin}`));
            const dadosAtuais = userSnap.val();

            const groupsSnap = await get(ref(db, "groups"));
            if (groupsSnap.exists()) {
                const updates = {};
                groupsSnap.forEach(groupChild => {
                    const groupId = groupChild.key;
                    const groupData = groupChild.val();
                    if (groupData.members && groupData.members[antigoLogin]) {
                        updates[`groups/${groupId}/members/${novoLogin}`] = true;
                        updates[`groups/${groupId}/members/${antigoLogin}`] = null;
                    }
                    if (groupData.admin === antigoLogin) updates[`groups/${groupId}/admin`] = novoLogin;
                    if (groupData.admins && groupData.admins[antigoLogin]) {
                        updates[`groups/${groupId}/admins/${novoLogin}`] = true;
                        updates[`groups/${groupId}/admins/${antigoLogin}`] = null;
                    }
                });
                await update(ref(db), updates);
            }

            const chatsSnap = await get(ref(db, "chats"));
            if (chatsSnap.exists()) {
                const chats = chatsSnap.val();
                for (let chatId in chats) {
                    if (chatId.includes(antigoLogin) && chatId.includes("_")) {
                        const amigo = chatId.replace(antigoLogin, "").replace("_", "");
                        const novoChatId = [novoLogin, amigo].sort().join("_");
                        await set(ref(db, `chats/${novoChatId}`), chats[chatId]);
                        await remove(ref(db, `chats/${chatId}`));
                        
                        const mensagensSnap = await get(ref(db, `chats/${novoChatId}`));
                        const msgUpdates = {};
                        mensagensSnap.forEach(m => { if (m.val().sender === antigoLogin) msgUpdates[`chats/${novoChatId}/${m.key}/sender`] = novoLogin; });
                        await update(ref(db), msgUpdates);
                    }
                }
            }
            await set(ref(db, `users/${novoLogin}`), dadosAtuais);
            await remove(ref(db, `users/${antigoLogin}`));

            alert("Migração concluída! Faça login novamente com o novo login.");
            await signOut(auth);
            location.reload();
        } catch (e) { alert("Erro na migração: " + e.message); }
    };
}

const changeNameBtn = document.getElementById("changeNameBtn");
if(changeNameBtn){
    changeNameBtn.onclick = async () => {
        const novoNome = document.getElementById("newName").value.trim();
        if (!novoNome) return alert("Digite um nome válido!");
        try {
            await update(ref(db, `users/${currentUser}`), { displayName: novoNome });
            alert("Nome atualizado!"); document.getElementById("newName").value = "";
        } catch (error) { alert("Erro ao atualizar nome."); }
    };
}

const toggleEditBtn = document.getElementById("toggleEditBtn");
if(toggleEditBtn){
    toggleEditBtn.onclick = () => {
        const section = document.getElementById("edit-section");
        const isHidden = section.style.display === "none" || section.style.display === "";
        section.style.display = isHidden ? "block" : "none";
        toggleEditBtn.innerText = isHidden ? "Fechar Edição" : "Editar Perfil";
        toggleEditBtn.style.background = isHidden ? "var(--danger)" : "#444";
    };
}

const toggleLoginChangeBtn = document.getElementById("toggleLoginChangeBtn");
if(toggleLoginChangeBtn){
    toggleLoginChangeBtn.onclick = () => {
        const loginSection = document.getElementById("login-change-section");
        loginSection.style.display = loginSection.style.display === "none" ? "block" : "none";
    };
}

const fileInput = document.getElementById("fileInput");
if(fileInput) fileInput.onchange = (e) => abrirCropper(e, 'profile', 1);

const wallpaperInput = document.getElementById("wallpaperInput");
if(wallpaperInput) wallpaperInput.onchange = (e) => abrirCropper(e, 'wallpaper', null); 

const groupPhotoInput = document.getElementById("groupPhotoInput");
if(groupPhotoInput) groupPhotoInput.onchange = (e) => abrirCropper(e, 'group', 1);

function abrirCropper(e, type, ratio) {
    const file = e.target.files[0];
    if (!file) return;
    currentCropType = type;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const modal = document.getElementById("cropperModal");
        const img = document.getElementById("imageToCrop");
        modal.style.display = "flex";
        img.onload = () => {
            if (cropperInstance) cropperInstance.destroy();
            cropperInstance = new Cropper(img, { aspectRatio: ratio, viewMode: 1, guides: true, background: false, autoCropArea: 1 });
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file); e.target.value = ''; 
}

const btnConfirmCrop = document.getElementById("confirmCrop");
if (btnConfirmCrop) {
    btnConfirmCrop.onclick = async (e) => {
        e.preventDefault(); 
        if (!cropperInstance) return;
        let cropOptions = (currentCropType === 'profile' || currentCropType === 'group') ? { width: 400, height: 400 } : { width: 800 }; 
        const canvas = cropperInstance.getCroppedCanvas(cropOptions);
        if (!canvas) return alert("Erro ao processar imagem.");
        const base64 = canvas.toDataURL("image/jpeg", 0.6);

        try {
            btnConfirmCrop.innerText = "Salvando..."; btnConfirmCrop.disabled = true;
            if (currentCropType === 'profile') {
                await update(ref(db, `users/${currentUser}`), { photoUrl: base64 });
                document.getElementById("profilePhoto").src = base64;
            } else if (currentCropType === 'group') {
                await update(ref(db, `groups/${activeChatId}`), { photoUrl: base64 });
            } else {
                await set(ref(db, `users/${currentUser}/wallpapers/${activeChatId}`), base64);
                document.getElementById("messages").style.backgroundImage = `url(${base64})`;
            }
            document.getElementById("cropperModal").style.display = "none";
            cropperInstance.destroy(); cropperInstance = null;
        } catch (error) { alert("Falha ao salvar: " + error.message); } 
        finally { btnConfirmCrop.innerText = "Salvar Foto"; btnConfirmCrop.disabled = false; }
    };
}

const btnCancelCrop = document.getElementById("cancelCrop");
if (btnCancelCrop) {
    btnCancelCrop.onclick = (e) => {
        e.preventDefault(); 
        document.getElementById("cropperModal").style.display = "none";
        if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
    };
}

function abrirChat(titulo) {
    limparListenersChat();
    const statusLabel = document.getElementById("chatStatus");
    const chatTitleElem = document.getElementById("chatWithTitle");
    
    if(chatTitleElem) chatTitleElem.innerText = titulo;
    if(statusLabel) statusLabel.innerText = ""; 
    showScreen("chat-screen");

    if (!isGroup) {
        const amigo = activeChatId.split("_").find(nome => nome !== currentUser);
        if (amigo) {
            statusUnsubscribe = onValue(ref(db, `users/${amigo}/status`), (snap) => {
                if(!statusLabel) return;
                const isOnline = snap.val() === "online";
                statusLabel.innerText = isOnline ? "● Online" : "○ Offline";
                statusLabel.style.color = isOnline ? "#2ecc71" : "#aaa";
            });
        }
    } else { if(statusLabel) { statusLabel.innerText = "Conversa em Grupo"; statusLabel.style.color = "#aaa"; } }

    get(ref(db, `users/${currentUser}/wallpapers/${activeChatId}`)).then(snap => {
        const msgContainer = document.getElementById("messages");
        if(msgContainer) msgContainer.style.backgroundImage = snap.exists() ? `url(${snap.val()})` : "none";
    });
    loadMessages();
}

function loadMessages() {
    get(ref(db, "users")).then(userSnap => {
        if (!activeChatId) return;
        limparListenersChat();
        const allUsers = userSnap.val() || {};
        
        chatUnsubscribe = onValue(ref(db, "chats/" + activeChatId), snap => {
            const box = document.getElementById("messages");
            if (!box) return;
            box.innerHTML = "";
            
            snap.forEach(child => {
                if (child.key === "typing") return;
                const m = child.val();
                const msgKey = child.key;
                const isMine = m.sender === currentUser;
                const userData = allUsers[m.sender] || {};
                const senderPhoto = userData.photoUrl || DEFAULT_AVATAR;
                const displayName = userData.displayName || m.sender;
                
                if (!isMine && !m.read) setTimeout(() => update(ref(db, `chats/${activeChatId}/${msgKey}`), { read: true }), 100);

                const row = document.createElement("div");
                row.className = `message-row ${isMine ? 'my-message-row' : ''}`;

                let timer;
                row.onmousedown = row.ontouchstart = () => {
                    timer = setTimeout(() => {
                        window.prepararResposta(m.type === 'text' ? m.text : `[${m.type}]`, displayName);
                        if (navigator.vibrate) navigator.vibrate(50);
                    }, 600); 
                };
                row.onmouseup = row.onmouseleave = row.ontouchend = () => clearTimeout(timer);

                const readReceipt = isMine ? `<span style="color:${m.read ? '#4dabf7' : '#ccc'}; font-size:11px; margin-left:8px; text-shadow:1px 1px 1px black;">${m.read ? '✓✓' : '✓'}</span>` : "";
                const deleteBtn = (isMine && (Date.now() - m.timestamp <= 60000)) ? `<span class="del-msg-btn" onclick="window.apagarMensagem('${msgKey}')" style="cursor:pointer; font-size:12px; margin-right:8px; opacity:0.5;">🗑️</span>` : "";

                // FIX 2: max-width na bolha de citação para nao quebrar o layout
                const replyHtml = m.replyTo ? `
                    <div style="background: rgba(0,0,0,0.2); border-left: 3px solid var(--primary); padding: 5px; margin-bottom: 5px; border-radius: 4px; font-size: 11px; text-align: left; cursor: pointer; max-width: 100%; overflow: hidden;">
                        <b style="color: var(--primary);">${m.replyTo.autor}</b><br>
                        <span style="opacity: 0.8; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;">${m.replyTo.texto}</span>
                    </div>` : "";

                let content = "";
                if (m.type === 'image') content = `<div style="display:flex; flex-direction:column; align-items:flex-end;">${replyHtml}<img src="${m.text}" class="chat-img-msg" onclick="window.openFullImage('${m.text}')">${readReceipt}</div>`;
                else if (m.type === 'video') content = `<div style="display:flex; flex-direction:column; align-items:flex-end;">${replyHtml}<video src="${m.text}" controls class="chat-img-msg"></video>${readReceipt}</div>`;
                else if (m.type === 'sticker') content = `<div style="display:flex; flex-direction:column; align-items:flex-end;">${replyHtml}<img src="${m.text}" onclick="window.openFullImage('${m.text}')" style="width: 130px; height: 130px; object-fit: contain; background: transparent; cursor: pointer;">${readReceipt}</div>`;
                else if (m.type === 'audio') content = `<div style="display:flex; flex-direction:column; align-items:flex-start;">${replyHtml}<div style="display:flex; align-items:flex-end;"><audio src="${m.text}" controls preload="metadata" style="max-width: 200px; height: 35px;"></audio>${readReceipt}</div></div>`;
                else content = `<div class="msg-bubble" style="background:${isMine ? 'var(--primary)' : '#444'};">${replyHtml}<span>${m.text}</span>${readReceipt}</div>`;

                row.innerHTML = `
                    ${!isMine ? `<img src="${senderPhoto}" class="chat-avatar">` : ''}
                    <div class="msg-wrapper">
                        ${(isGroup && !isMine) ? `<span class="msg-name">${displayName}</span>` : ''}
                        <div style="display:flex; align-items:center;">${content}</div>
                    </div>
                    ${isMine ? `<img src="${senderPhoto}" class="chat-avatar">` : ''}
                    ${isMine ? deleteBtn : ''}
                `;
                box.appendChild(row);
            });
            box.scrollTop = box.scrollHeight;
        });

        typingUnsubscribe = onValue(ref(db, `chats/${activeChatId}/typing`), snap => {
            const data = snap.val() || {};
            const tipando = Object.keys(data).filter(u => u !== currentUser && data[u]);
            const indicator = document.getElementById("typingIndicator");
            if(indicator){
                indicator.innerText = tipando.length > 0 ? `${tipando[0]} está digitando...` : "";
                indicator.style.display = tipando.length > 0 ? "block" : "none";
            }
        });
    });
}

const backToProfile = document.getElementById("backToProfile");
if(backToProfile) {
    backToProfile.onclick = () => {
        if (activeChatId && currentUser) set(ref(db, `chats/${activeChatId}/typing/${currentUser}`), false);
        activeChatId = null; limparListenersChat(); showScreen("profile-screen");
    };
}

async function sendMessage() {
    if(!campoTexto) return;
    const texto = campoTexto.value.trim();
    if (texto !== "" && activeChatId) {
        try {
            const dadosMsg = { sender: currentUser, text: texto, type: 'text', timestamp: Date.now(), read: false };
            if (respondendoMensagem) dadosMsg.replyTo = respondendoMensagem;
            await push(ref(db, "chats/" + activeChatId), dadosMsg);
            campoTexto.value = "";
            if(iconeBotao) iconeBotao.innerText = "🎤";
            set(ref(db, `chats/${activeChatId}/typing/${currentUser}`), false);
            window.cancelarResposta(); 
        } catch (e) { console.error("Erro ao enviar:", e); }
    }
}

async function handleAudio() {
    if(!iconeBotao) return;
    if (iconeBotao.innerText === "🎤") {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
            mediaRecorder = new MediaRecorder(stream, { mimeType });
            audioChunks = [];

            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: mimeType });
                audioChunks = [];
                if (!activeChatId || audioBlob.size < 100) return;
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = async () => {
                    try { await push(ref(db, `chats/${activeChatId}`), { sender: currentUser, text: reader.result, type: 'audio', timestamp: Date.now(), read: false }); } 
                    catch (error) { console.error("Erro ao enviar áudio:", error); }
                };
                stream.getTracks().forEach(track => track.stop());
            };
            mediaRecorder.start(); iconeBotao.innerText = "⏹️"; iconeBotao.style.color = "var(--danger)"; 
        } catch (err) { alert("Permita o acesso ao microfone para gravar mensagens de áudio."); }
    } else {
        if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
        iconeBotao.innerText = "🎤"; iconeBotao.style.color = ""; 
    }
}

if(campoTexto) {
    campoTexto.addEventListener("input", () => {
        if(iconeBotao) iconeBotao.innerText = campoTexto.value.trim() !== "" ? "➤" : "🎤";
        if (activeChatId && currentUser) {
            set(ref(db, `chats/${activeChatId}/typing/${currentUser}`), true);
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => { if(activeChatId) set(ref(db, `chats/${activeChatId}/typing/${currentUser}`), false); }, 2000);
        }
    });
}

const actionBtn = document.getElementById("actionBtn");
if(actionBtn) {
    actionBtn.onclick = (e) => { e.preventDefault(); iconeBotao && iconeBotao.innerText === "➤" ? sendMessage() : handleAudio(); };
}

const mediaInput = document.getElementById("mediaInput");
if(mediaInput) {
    mediaInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file || !activeChatId) return;
        if (file.size > 5 * 1024 * 1024) alert("Atenção: Arquivo maior que 5MB pode demorar um pouco.");

        const iconeOriginal = document.getElementById("actionIcon").innerText;
        document.getElementById("actionIcon").innerText = "⏳"; // Mostra que tá carregando
        
        const urlExterna = await uploadParaCatbox(file);
        
        if (urlExterna) {
            try {
                // Descobre se é vídeo ou imagem para o Firebase saber como renderizar
                const tipoArquivo = file.type.startsWith('video') ? 'video' : 'image';
                
                await push(ref(db, `chats/${activeChatId}`), { 
                    sender: currentUser, 
                    text: urlExterna, // O link levinho do Catbox
                    type: tipoArquivo, 
                    timestamp: Date.now(), 
                    read: false 
                });
            } catch (error) { 
                alert("Erro ao salvar mensagem no banco."); 
            }
        } else {
            alert("Erro ao fazer upload para o Catbox.");
        }
        
        document.getElementById("actionIcon").innerText = iconeOriginal;
        e.target.value = ''; 
    };
}

const stickerInput = document.getElementById("stickerInput");
if(stickerInput) {
    stickerInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file || !activeChatId) return;
        
        const iconeOriginal = document.getElementById("actionIcon").innerText;
        document.getElementById("actionIcon").innerText = "⏳";
        
        const urlExterna = await uploadParaCatbox(file);
        
        if (urlExterna) {
            try {
                await push(ref(db, `chats/${activeChatId}`), { 
                    sender: currentUser, 
                    text: urlExterna, 
                    type: 'sticker', 
                    timestamp: Date.now(), 
                    read: false 
                });
            } catch (error) { alert("Erro ao criar figurinha."); }
        } else {
            alert("Erro ao hospedar a figurinha no Catbox.");
        }
        
        document.getElementById("actionIcon").innerText = iconeOriginal;
        e.target.value = ''; 
    };
}


const addFriendBtn = document.getElementById("addFriendBtn");
if(addFriendBtn){
    addFriendBtn.onclick = async () => {
        const f = document.getElementById("friendIdInput").value.trim().toLowerCase();
        if (!f || f === currentUser) return;
        const check = await get(ref(db, "users/" + f));
        if (check.exists()) {
            isGroup = false; activeChatId = [currentUser, f].sort().join("_");
            await remove(ref(db, `users/${currentUser}/hiddenDMs/${activeChatId}`));
            if(document.getElementById("deleteGroupBtn")) document.getElementById("deleteGroupBtn").style.display = "none";
            if(document.getElementById("addMemberBtn")) document.getElementById("addMemberBtn").style.display = "none";
            abrirChat(f);
        } else { alert("Usuário não encontrado!"); }
    };
}

function loadDMs() {
    if (dmsChatsUnsubscribe) dmsChatsUnsubscribe();
    dmsChatsUnsubscribe = onValue(ref(db, "chats"), snap => {
        get(ref(db, `users/${currentUser}/hiddenDMs`)).then(hiddenSnap => {
            const hiddenDMs = hiddenSnap.val() || {};
            const list = document.getElementById("friendsList");
            if (!list) return;
            list.innerHTML = "";
            const chats = snap.val() || {};
            
            Object.keys(chats).forEach(chatId => {
                if (chatId.includes('_') && chatId.includes(currentUser)) {
                    const mensagens = chats[chatId];
                    let unreadCount = 0;
                    Object.keys(mensagens).forEach(k => { if (k !== 'typing' && mensagens[k].sender !== currentUser && !mensagens[k].read) unreadCount++; });

                    if (hiddenDMs[chatId] && unreadCount === 0) return;
                    const amigo = chatId.replace(currentUser, "").replace("_", "");
                    const div = document.createElement("div");
                    div.style.cssText = "display:flex; align-items:center; gap:5px; margin-bottom:8px;";

                    const btn = document.createElement("button");
                    btn.className = "group-btn-list"; btn.style.flex = "1";
                    const badgeHtml = unreadCount > 0 ? `<span class="badge">${unreadCount > 10 ? '10+' : unreadCount}</span>` : "";

                    get(ref(db, `users/${amigo}`)).then(uSnap => {
                        const d = uSnap.val();
                        btn.innerHTML = `<img src="${d?.photoUrl || DEFAULT_AVATAR}" style="width:28px; height:28px; border-radius:50%; object-fit:cover; vertical-align:middle;"> <span style="flex:1; text-align:left;">${d?.displayName || amigo}</span>${badgeHtml}`;
                    });

                    btn.onclick = () => { isGroup = false; activeChatId = chatId; abrirChat(amigo); };
                    
                    const closeBtn = document.createElement("button");
                    closeBtn.innerHTML = "✖"; closeBtn.style.cssText = "background:var(--danger); padding:12px 15px; margin:0;";
                    closeBtn.onclick = async (e) => {
                        e.stopPropagation();
                        if (confirm("Deseja fechar esta conversa?")) { await set(ref(db, `users/${currentUser}/hiddenDMs/${chatId}`), true); loadDMs(); }
                    };
                    div.append(btn, closeBtn); list.appendChild(div);
                }
            });
        });
    });
}

function loadGroups() {
    if (groupsChatsUnsubscribe) groupsChatsUnsubscribe();
    groupsChatsUnsubscribe = onValue(ref(db, "groups"), snapGroups => {
        get(ref(db, "chats")).then(snapChats => {
            const list = document.getElementById("groupsList");
            if (!list) return;
            list.innerHTML = "";
            const todosOsChats = snapChats.val() || {};
            snapGroups.forEach(child => {
                const g = child.val();
                if (!g || !g.members || !g.members[currentUser]) return;

                const groupId = child.key;
                const mensagensDoGrupo = todosOsChats[groupId] || {};
                let unreadCount = 0;
                Object.keys(mensagensDoGrupo).forEach(k => { if (k !== 'typing' && mensagensDoGrupo[k].sender !== currentUser && !mensagensDoGrupo[k].read) unreadCount++; });

                const badgeHtml = unreadCount > 0 ? `<span class="badge">${unreadCount > 10 ? '10+' : unreadCount}</span>` : "";
                const btn = document.createElement("button");
                btn.className = "group-btn-list";
                btn.innerHTML = `<img src="${g.photoUrl || DEFAULT_AVATAR}" style="width:28px; height:28px; border-radius:50%; object-fit:cover;"> <span style="flex:1;">${g.name}</span>${badgeHtml}`;
                btn.onclick = () => { isGroup = true; activeChatId = groupId; abrirChat(g.name); };
                list.appendChild(btn);
            });
        });
    });
}

const createGroupBtn = document.getElementById("createGroupBtn");
if(createGroupBtn){
    createGroupBtn.onclick = async () => {
        const nome = document.getElementById("groupNameInput").value.trim();
        if (!nome) return;
        await set(push(ref(db, "groups")), { name: nome, admin: currentUser, members: { [currentUser]: true } });
        document.getElementById("groupNameInput").value = "";
    };
}

const deleteGroupBtn = document.getElementById("deleteGroupBtn");
if(deleteGroupBtn) deleteGroupBtn.onclick = abrirTelaGrupo;

const addMemberBtn = document.getElementById("addMemberBtn");
if(addMemberBtn){
    addMemberBtn.onclick = async () => {
        const novoMembro = prompt("Digite o login do usuário para adicionar:");
        if (!novoMembro) return;
        if ((await get(ref(db, `users/${novoMembro.toLowerCase()}`))).exists()) {
            await update(ref(db, `groups/${activeChatId}/members`), { [novoMembro.toLowerCase()]: true });
            alert("Membro adicionado!");
        } else { alert("Usuário não encontrado."); }
    };
}

const areaClique = document.getElementById("headerClickArea");
if (areaClique) areaClique.onclick = () => { if (isGroup && activeChatId) abrirTelaGrupo(); };

const closeGroupInfoBtn = document.getElementById("closeGroupInfoBtn");
if(closeGroupInfoBtn) closeGroupInfoBtn.onclick = () => document.getElementById("group-info-screen").style.display = "none";

function abrirTelaGrupo() {
    document.getElementById("group-info-screen").style.display = "block";
    onValue(ref(db, `groups/${activeChatId}`), async (snap) => {
        const g = snap.val();
        if (!g) return;

        if(document.getElementById("groupInfoName")) document.getElementById("groupInfoName").innerText = g.name;
        if(document.getElementById("groupPhotoPreview")) document.getElementById("groupPhotoPreview").src = g.photoUrl || DEFAULT_AVATAR;

        const isOwner = g.admin === currentUser;
        const isMembroAdmin = isOwner || (g.admins && g.admins[currentUser]);

        if(document.getElementById("editGroupNameBtn")) document.getElementById("editGroupNameBtn").style.display = isMembroAdmin ? "block" : "none";
        if(document.getElementById("groupAddMemberDiv")) document.getElementById("groupAddMemberDiv").style.display = isMembroAdmin ? "block" : "none";
        
        const delBtnInfo = document.getElementById("deleteGroupBtnInfo");
        if(delBtnInfo) {
            delBtnInfo.style.display = isOwner ? "block" : "none";
            delBtnInfo.onclick = async () => {
                if(confirm("Apagar grupo para todos?")) {
                    await remove(ref(db, `groups/${activeChatId}`));
                    await remove(ref(db, `chats/${activeChatId}`));
                    document.getElementById("group-info-screen").style.display = "none"; showScreen("profile-screen");
                }
            };
        }
        
        const leaveBtnInfo = document.getElementById("leaveGroupBtnInfo");
        if(leaveBtnInfo) {
            leaveBtnInfo.onclick = async () => {
                if(confirm("Deseja sair deste grupo?")) {
                    if (isOwner) {
                        const members = Object.keys(g.members || {}).filter(m => m !== currentUser);
                        if (members.length === 0) {
                            await remove(ref(db, `groups/${activeChatId}`)); await remove(ref(db, `chats/${activeChatId}`));
                        } else {
                            const newAdmin = members.find(m => g.admins && g.admins[m]) || members[Math.floor(Math.random() * members.length)];
                            await update(ref(db, `groups/${activeChatId}`), { admin: newAdmin });
                            await update(ref(db, `groups/${activeChatId}/admins`), { [newAdmin]: true });
                            await remove(ref(db, `groups/${activeChatId}/members/${currentUser}`));
                            await remove(ref(db, `groups/${activeChatId}/admins/${currentUser}`));
                        }
                    } else {
                        await remove(ref(db, `groups/${activeChatId}/members/${currentUser}`));
                        await remove(ref(db, `groups/${activeChatId}/admins/${currentUser}`));
                    }
                    document.getElementById("group-info-screen").style.display = "none"; showScreen("profile-screen");
                }
            };
        }

        if(document.getElementById("groupPhotoPreview")) {
            document.getElementById("groupPhotoPreview").onclick = () => { if (isMembroAdmin) document.getElementById("groupPhotoInput")?.click(); };
        }
        
        if(document.getElementById("editGroupNameBtn")) {
            document.getElementById("editGroupNameBtn").onclick = async () => {
                const novoNome = prompt("Novo nome do grupo:", g.name);
                if (novoNome && novoNome.trim() !== "") {
                    await update(ref(db, `groups/${activeChatId}`), { name: novoNome });
                    if(document.getElementById("chatWithTitle")) document.getElementById("chatWithTitle").innerText = novoNome;
                }
            };
        }

        const membersList = document.getElementById("groupMembersList");
        if(membersList) {
            membersList.innerHTML = "";
            const allUsers = (await get(ref(db, "users"))).val() || {};

            Object.keys(g.members || {}).forEach(membro => {
                const ehAdmin = g.admin === membro || (g.admins && g.admins[membro]);
                const userData = allUsers[membro] || {};
                const isOnline = userData.status === "online";
                
                const div = document.createElement("div");
                div.style.cssText = "display:flex; align-items:center; text-align:left; background:var(--bg-light); padding:10px; border-radius:8px;";

                let botoesAdmin = (isMembroAdmin && membro !== currentUser) ? `
                    <button onclick="window.promoverRebaixar('${membro}', ${ehAdmin})" style="background:${ehAdmin ? 'var(--warning)' : 'var(--primary)'}; font-size:10px; padding:5px; margin-left:auto;">${ehAdmin ? 'Remover Admin' : 'Dar Admin'}</button>
                    <button onclick="window.removerDoGrupo('${membro}')" style="background:var(--danger); font-size:10px; padding:5px; margin-left:5px;">Expulsar</button>
                ` : "";

                // FIX 6: Removido "color: white" que atrapalhava no light mode, usando var(--text)
                div.innerHTML = `
                    <img src="${userData.photoUrl || DEFAULT_AVATAR}" style="width:35px; height:35px; border-radius:50%; object-fit:cover; margin-right:10px;">
                    <div style="flex:1; display:flex; flex-direction:column; align-items:flex-start;"> 
                        <div style="display:flex; align-items:center;">
                            <span style="font-weight:bold; color: var(--text);">${membro}</span>
                            ${ehAdmin ? '<span style="color:var(--success); font-size:11px; margin-left:5px;">(Admin)</span>' : ''}
                        </div>
                        <span style="color:${isOnline ? '#2ecc71' : '#aaa'}; font-size:11px; margin-top:2px;">${isOnline ? '● Online' : '○ Offline'}</span>
                    </div>${botoesAdmin}
                `;
                membersList.appendChild(div);
            });
        }
    });
}

const addNewGroupMemberBtn = document.getElementById("addNewGroupMemberBtn");
if(addNewGroupMemberBtn){
    addNewGroupMemberBtn.onclick = async () => {
        const novo = document.getElementById("newGroupMemberInput").value.trim().toLowerCase();
        if (!novo) return;
        if ((await get(ref(db, `users/${novo}`))).exists()) {
            await update(ref(db, `groups/${activeChatId}/members`), { [novo]: true });
            document.getElementById("newGroupMemberInput").value = ""; alert("Usuário adicionado!");
        } else { alert("Usuário não existe!"); }
    };
}

const favoriteImageBtn = document.getElementById("favoriteImageBtn");
if(favoriteImageBtn){
    favoriteImageBtn.onclick = async (e) => {
        e.preventDefault();
        const src = document.getElementById("modalImg")?.src;
        if(!currentUser || !src) return;
        try {
            await push(ref(db, `users/${currentUser}/favorites`), src);
            alert("Figurinha salva!"); document.getElementById("imageModal").style.display = 'none';
        } catch(err) { alert("Erro ao favoritar."); }
    };
}

const openFavoritesBtn = document.getElementById("openFavoritesBtn");
if(openFavoritesBtn){
    openFavoritesBtn.onclick = async () => {
        if(!currentUser) return;
        const modal = document.getElementById("favoritesModal");
        if(modal) modal.style.display = "flex";
        
        const grid = document.getElementById("favoritesGrid");
        if(!grid) return;
        grid.innerHTML = "<p style='width: 100%; text-align: center;'>Carregando...</p>";
        
        get(ref(db, `users/${currentUser}/favorites`)).then(snap => {
            grid.innerHTML = "";
            if(!snap.exists()) return grid.innerHTML = "<p style='width: 100%; text-align: center;'>Nenhuma figurinha salva ainda.</p>";
            
            snap.forEach(child => {
                const imgBase64 = child.val(); const key = child.key;
                const wrapper = document.createElement("div"); wrapper.style.position = "relative";
                const img = document.createElement("img"); img.src = imgBase64;
                img.style.cssText = "width: 80px; height: 80px; object-fit: contain; cursor: pointer; background: rgba(0,0,0,0.2); border-radius: 8px;";
                img.onclick = () => window.sendFavoriteSticker(imgBase64);
                
                const delBtn = document.createElement("button"); delBtn.innerText = "🗑️";
                delBtn.style.cssText = "position: absolute; top: -5px; right: -5px; background: red; padding: 2px 5px; font-size: 10px; border-radius: 50%;";
                delBtn.onclick = (e) => {
                    e.stopPropagation(); remove(ref(db, `users/${currentUser}/favorites/${key}`)); wrapper.remove();
                };
                wrapper.append(img, delBtn); grid.appendChild(wrapper);
            });
        });
    };
}

const alternarTema = () => localStorage.setItem("globalTheme", document.body.classList.toggle("light-mode") ? "light" : "dark");
document.getElementById("themeToggleBtn")?.addEventListener("click", alternarTema);
document.getElementById("mainThemeToggleBtn")?.addEventListener("click", alternarTema);
if(localStorage.getItem("globalTheme") === "light") document.body.classList.add("light-mode");

const colorPicker = document.getElementById("chatColorPicker");
if (colorPicker) {
    colorPicker.oninput = (e) => {
        if (activeChatId) {
            document.body.style.setProperty('--primary', e.target.value);
            localStorage.setItem('chatColor_' + activeChatId, e.target.value);
        }
    };
}
const wallpaperBtn = document.getElementById("wallpaperBtn");
if (wallpaperBtn) wallpaperBtn.onclick = () => document.getElementById("wallpaperInput")?.click();

// FIX 5: AVISOS COM NICK ESPECIFICO
const enviarAvisoBtn = document.getElementById("enviarAvisoBtn");
if(enviarAvisoBtn) {
    enviarAvisoBtn.onclick = async () => {
        const local = document.getElementById("avisoLocal").value;
        const texto = document.getElementById("avisoTexto").value.trim();
        const dataSpec = document.getElementById("avisoData").value;
        const horaInicio = document.getElementById("avisoHora").value || "00:00";
        const nickDestino = document.getElementById("avisoNick").value.trim().toLowerCase();
        
        if(!texto || !dataSpec) return alert("Preencha tudo!");
        const novaRef = push(ref(db, `admin/avisos`)); 
        await set(novaRef, { idAviso: novaRef.key, localDestino: local, texto, dataSpec, horaInicio, ativo: true, destinatario: nickDestino || "todos" });
        alert("Aviso agendado!");
    };
}

const removerAvisoBtn = document.getElementById("removerAvisoBtn");
if(removerAvisoBtn) {
    removerAvisoBtn.onclick = async () => {
        const local = document.getElementById("avisoLocal").value;
        if(confirm(`Tirar os avisos da tela de ${local}?`)) {
            await set(ref(db, `admin/avisos/${local}/ativo`), false); alert("Aviso desativado!");
        }
    };
}

function escutarAvisos() {
    onValue(ref(db, `admin/avisos`), snap => {
        const dados = snap.val();
        if(!dados) return;

        const agora = new Date();
        const hoje = agora.toISOString().split('T')[0];
        const horaAtual = agora.getHours().toString().padStart(2, '0') + ":" + agora.getMinutes().toString().padStart(2, '0');
        const localUser = currentUser ? "profile" : "login";

        const avisosPendentes = Object.values(dados).filter(aviso => 
            aviso.ativo && aviso.localDestino === localUser && aviso.dataSpec === hoje && horaAtual >= aviso.horaInicio && 
            !localStorage.getItem("aviso_fechado_" + aviso.idAviso) &&
            (aviso.destinatario === "todos" || aviso.destinatario === currentUser)
        );

        const popUp = document.getElementById("globalPopUp");
        if (avisosPendentes.length > 0) {
            const primeiroDaFila = avisosPendentes[0];
            document.getElementById("globalPopUpText").innerText = primeiroDaFila.texto;
            popUp.style.display = "flex";            
            window.fecharPopUpGlobal = () => {
                localStorage.setItem("aviso_fechado_" + primeiroDaFila.idAviso, "true");
                popUp.style.display = "none"; setTimeout(escutarAvisos, 300); 
            };
        } else if (popUp) { popUp.style.display = "none"; }
    });
}
escutarAvisos();

window.registrarErroAdmin = (acao, msgErro) => { try { push(ref(db, `admin/erros`), { user: currentUser || "Deslogado", acao, msg: msgErro, time: Date.now() }); } catch(e){} };

function carregarErros() {
    onValue(ref(db, `admin/erros`), snap => {
        const lista = document.getElementById("listaErrosAdmin");
        if(!lista) return;
        lista.innerHTML = "";
        
        if(!snap.exists()) return lista.innerHTML = "Nenhum erro registrado hoje. Tudo limpo! ✨";

        let temErroHoje = false;
        const inicioDoDia = new Date().setHours(0,0,0,0);

        snap.forEach(child => {
            const err = child.val();
            if(err.time >= inicioDoDia) {
                temErroHoje = true;
                lista.innerHTML += `<div style="margin-bottom: 5px; border-bottom: 1px solid #555; padding-bottom: 5px;">
                    <span style="color:var(--danger)">[${new Date(err.time).toLocaleTimeString()}]</span> 
                    <b>@${err.user}:</b> <span style="color: white;">${err.acao}</span><br>
                    <span style="opacity: 0.8;">${err.msg}</span>
                </div>`;
            }
        });
        if(!temErroHoje) lista.innerHTML = "Nenhum erro registrado hoje. Tudo limpo! ✨";
        lista.scrollTop = lista.scrollHeight;
    });
}
const limparErrosBtn = document.getElementById("limparErrosBtn");
if(limparErrosBtn) limparErrosBtn.onclick = async () => confirm("Apagar histórico de erros?") && await remove(ref(db, `admin/erros`));

// Função para hospedar qualquer arquivo (imagem, vídeo, áudio) no Catbox
async function uploadParaCatbox(file) {
    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("fileToUpload", file);

    try {
        const response = await fetch("https://catbox.moe/user/api.php", {
            method: "POST",
            body: formData
        });

        if (response.ok) {
            const url = await response.text(); // O Catbox devolve o link em texto puro!
            return url.trim(); 
        } else {
            throw new Error("Falha ao enviar para o Catbox");
        }
    } catch (error) {
        console.error("Erro no upload externo:", error);
        return null;
    }
}
