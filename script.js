// 1. IMPORTS (Sempre no topo)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, get, set, update, push, onValue, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut, updatePassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getStorage, ref as sRef, uploadBytes, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// 2. CONFIGURAÇÃO
const firebaseConfig = {
    apiKey: "AIzaSyDdKY_RF0804x0iMp40PjMyS31XuWKmO-8",
    authDomain: "teste66666-fade0.firebaseapp.com",
    projectId: "teste66666-fade0",
    storageBucket: "teste66666-fade0.firebasestorage.app",
    messagingSenderId: "117822974206",
    appId: "1:117822974206:web:455be5577682e885ea9daf",
    databaseURL: "https://teste66666-fade0-default-rtdb.firebaseio.com"
};

// 3. INICIALIZAÇÃO
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);               
const auth = getAuth(app);                 
const storage = getStorage(app);           

// --- ESTADO GLOBAL ---
let currentUser = null;
let activeChatId = null;
let isGroup = false;

// Variáveis para limpar os olheiros (listeners) e evitar duplicação
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

// Função para gerenciar se você está online ou não
function gerenciarPresenca() {
    if (!currentUser) return;
    const myStatusRef = ref(db, `users/${currentUser}/status`);
    const connectedRef = ref(db, ".info/connected");

    onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
            set(myStatusRef, "online");
            onDisconnect(myStatusRef).set("offline");
        }
    });
}

// --- AUTENTICAÇÃO E SESSÃO ---
document.getElementById("loginBtn").onclick = async () => {
    const u = document.getElementById("username").value.trim().toLowerCase();
    const p = document.getElementById("password").value.trim();

    try {
        await signInWithEmailAndPassword(auth, u + "@chat.com", p);
        currentUser = u; 
        showScreen("profile-screen");
        loadProfile();
        gerenciarPresenca();
        iniciarNotificacoesGlobais();
    } catch (e) {
        console.error(e);
        alert("Erro ao entrar: Verifique se o e-mail/senha existem no painel do Firebase.");
    }
};

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
    logoutBtn.onclick = async () => {
        if (!confirm("Tem certeza que deseja sair?")) return;
        if (currentUser) {
            await set(ref(db, `users/${currentUser}/status`), "offline");
        }
        await signOut(auth);
        location.reload(); 
    };
}

// --- ELEMENTOS DOM FREQUENTES ---
const campoTexto = document.getElementById("messageInput");
const iconeBotao = document.getElementById("actionIcon");

// --- NAVEGAÇÃO ---
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => {
        s.style.display = 'none';
        s.classList.remove('active-flex');
    });
    const screen = document.getElementById(id);
    if (screen) screen.style.display = 'flex'; 
}

const logarComEnter = (event) => {
    if (event.key === "Enter") document.getElementById("loginBtn").click();
};

const userField = document.getElementById("username");
const passField = document.getElementById("password");
if (userField) userField.addEventListener("keypress", logarComEnter);
if (passField) passField.addEventListener("keypress", logarComEnter);

// --- GERENCIAMENTO DE PERFIL ---
function loadProfile() {
    onValue(ref(db, "users/" + currentUser), snap => {
        const d = snap.val();
        if (d) {
            document.getElementById("displayUsername").innerText = d.displayName || currentUser;
            document.getElementById("profilePhoto").src = d.photoUrl || "https://cdn-icons-png.flaticon.com/512/149/149071.png";
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
            const user = auth.currentUser;
            if (user) {
                await updatePassword(user, novaSenha);
                alert("Senha alterada com sucesso!");
                document.getElementById("newPasswordInput").value = "";
                document.getElementById("login-change-section").style.display = "none";
            } else {
                alert("Erro: Sessão inválida. Tente deslogar e logar novamente.");
            }
        } catch (e) {
            if (e.code === 'auth/requires-recent-login') {
                alert("Por segurança, saia do aplicativo e faça login novamente antes de mudar a senha.");
            } else {
                alert("Erro ao mudar senha: " + e.message);
            }
        }
    };
}

document.getElementById("changeUsernameBtn").onclick = async () => {
    const novoLogin = document.getElementById("newUsernameInput").value.trim().toLowerCase();
    const antigoLogin = currentUser;

    if (!novoLogin || novoLogin === antigoLogin) return alert("Digite um login diferente!");

    try {
        const checkSnap = await get(ref(db, `users/${novoLogin}`));
        if (checkSnap.exists()) return alert("Este login já está em uso!");

        if (!confirm(`Atenção: Vamos mover todas as suas conversas para '${novoLogin}'. Você será deslogado.`)) return;

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
                    mensagensSnap.forEach(m => {
                        if (m.val().sender === antigoLogin) {
                            msgUpdates[`chats/${novoChatId}/${m.key}/sender`] = novoLogin;
                        }
                    });
                    await update(ref(db), msgUpdates);
                }
            }
        }

        await set(ref(db, `users/${novoLogin}`), dadosAtuais);
        await remove(ref(db, `users/${antigoLogin}`));

        alert("Migração concluída! Entre com seu novo login.");
        location.reload();
    } catch (e) { alert("Erro na migração: " + e.message); }
};

document.getElementById("changeNameBtn").onclick = async () => {
    const novoNome = document.getElementById("newName").value.trim();
    if (!novoNome) return alert("Digite um nome válido!");
    try {
        await update(ref(db, `users/${currentUser}`), { displayName: novoNome });
        alert("Nome atualizado!");
        document.getElementById("newName").value = "";
    } catch (error) { alert("Erro ao atualizar nome."); }
};

document.getElementById("toggleEditBtn").onclick = () => {
    const section = document.getElementById("edit-section");
    const btn = document.getElementById("toggleEditBtn");
    if (section.style.display === "none" || section.style.display === "") {
        section.style.display = "block";
        btn.innerText = "Fechar Edição";
        btn.style.background = "var(--danger)";
    } else {
        section.style.display = "none";
        btn.innerText = "Editar Perfil";
        btn.style.background = "#444";
    }
};

document.getElementById("toggleLoginChangeBtn").onclick = () => {
    const loginSection = document.getElementById("login-change-section");
    loginSection.style.display = loginSection.style.display === "none" ? "block" : "none";
};

// --- CROPPER (IMAGENS E FOTOS) ---
document.getElementById("fileInput").onchange = (e) => abrirCropper(e, 'profile', 1);
document.getElementById("wallpaperInput").onchange = (e) => abrirCropper(e, 'wallpaper', null); // FIX: Passar null para proporção livre no wallpaper
if(document.getElementById("groupPhotoInput")) document.getElementById("groupPhotoInput").onchange = (e) => abrirCropper(e, 'group', 1);

function abrirCropper(e, type, ratio) {
    const file = e.target.files[0];
    if (!file) return;
    currentCropType = type;
    const reader = new FileReader();
    
    reader.onload = (ev) => {
        const modal = document.getElementById("cropperModal");
        const img = document.getElementById("imageToCrop");
        modal.style.display = "flex";
        
        // FIX: Só inicie o Cropper DEPOIS que a imagem carregar na tela
        img.onload = () => {
            if (cropperInstance) cropperInstance.destroy();
            cropperInstance = new Cropper(img, {
                aspectRatio: ratio, 
                viewMode: 1, 
                guides: true, 
                background: false, 
                autoCropArea: 1
            });
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // FIX: Permite enviar a mesma foto de novo
}

const btnConfirmCrop = document.getElementById("confirmCrop");
if (btnConfirmCrop) {
    btnConfirmCrop.onclick = async (e) => {
    e.preventDefault(); 
    if (!cropperInstance) return;
    
    let cropOptions = (currentCropType === 'profile' || currentCropType === 'group') 
        ? { width: 400, height: 400 } : { width: 800 }; // Reduzimos um pouco para não pesar o banco

    const canvas = cropperInstance.getCroppedCanvas(cropOptions);
    if (!canvas) return alert("Erro ao processar imagem.");

    // Geramos o texto da imagem (Base64) bem compactado (0.6 de qualidade)
    const base64 = canvas.toDataURL("image/jpeg", 0.6);

    try {
        btnConfirmCrop.innerText = "Salvando...";
        btnConfirmCrop.disabled = true;

        if (currentCropType === 'profile') {
            await update(ref(db, `users/${currentUser}`), { photoUrl: base64 });
            document.getElementById("profilePhoto").src = base64;
        } else if (currentCropType === 'group') {
            await update(ref(db, `groups/${activeChatId}`), { photoUrl: base64 });
        } else {
            // Salva o wallpaper no banco para ele não sumir se você trocar de celular
            await set(ref(db, `users/${currentUser}/wallpapers/${activeChatId}`), base64);
            document.getElementById("messages").style.backgroundImage = `url(${base64})`;
        }

        document.getElementById("cropperModal").style.display = "none";
        cropperInstance.destroy();
        cropperInstance = null;
    } catch (error) {
        alert("Falha ao salvar: " + error.message);
    } finally {
        btnConfirmCrop.innerText = "Salvar Foto";
        btnConfirmCrop.disabled = false;
        }
    };
}

const btnCancelCrop = document.getElementById("cancelCrop");
if (btnCancelCrop) {
    btnCancelCrop.onclick = (e) => {
        e.preventDefault(); 
        document.getElementById("cropperModal").style.display = "none";
        if (cropperInstance) {
            cropperInstance.destroy();
            cropperInstance = null;
        }
    };
}

// --- CHAT E MENSAGENS ---
function abrirChat(titulo) {
    if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
    if (statusUnsubscribe) { statusUnsubscribe(); statusUnsubscribe = null; }
    if (typingUnsubscribe) { typingUnsubscribe(); typingUnsubscribe = null; }

    const statusLabel = document.getElementById("chatStatus");
    if(!statusLabel) return;
    
    document.getElementById("chatWithTitle").innerText = titulo;
    statusLabel.innerText = ""; 
    showScreen("chat-screen");

    if (isGroup === false) {
        const partes = activeChatId.split("_");
        const amigo = partes.find(nome => nome !== currentUser);
        
        if (amigo) {
            statusUnsubscribe = onValue(ref(db, `users/${amigo}/status`), (snap) => {
                const status = snap.val();
                if (status === "online") {
                    statusLabel.innerText = "● Online";
                    statusLabel.style.color = "#2ecc71";
                } else {
                    statusLabel.innerText = "○ Offline";
                    statusLabel.style.color = "#aaa";
                }
            });
        }
    } else {
        statusLabel.innerText = "Conversa em Grupo";
        statusLabel.style.color = "#aaa";
    }

    // Busca o wallpaper salvo no banco de dados
get(ref(db, `users/${currentUser}/wallpapers/${activeChatId}`)).then(snap => {
    if(snap.exists()){
        document.getElementById("messages").style.backgroundImage = `url(${snap.val()})`;
    } else {
        document.getElementById("messages").style.backgroundImage = "none";
    }
});

    loadMessages();
}

function loadMessages() {
    get(ref(db, "users")).then(userSnap => {
        if (!activeChatId) return; // FIX: Previne erro se o usuário sair rápido demais
        
        // FIX: Limpar listeners antigos ANTES de criar novos para evitar duplicações
        if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
        if (typingUnsubscribe) { typingUnsubscribe(); typingUnsubscribe = null; }

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
                const senderPhoto = userData.photoUrl || "https://cdn-icons-png.flaticon.com/512/149/149071.png";
                const displayName = userData.displayName || m.sender;
                
                if (!isMine && m.read === false) {
                    setTimeout(() => { 
                        update(ref(db, `chats/${activeChatId}/${msgKey}`), { read: true }); 
                    }, 100);
                }

                const row = document.createElement("div");
                row.className = `message-row ${isMine ? 'my-message-row' : ''}`;

                let readReceipt = "";
                if (isMine) { 
                    readReceipt = m.read 
                        ? `<span style="color:#4dabf7; font-size:11px; margin-left:8px;">✓✓</span>` 
                        : `<span style="color:#ccc; font-size:11px; margin-left:8px;">✓</span>`;
                }

                let deleteBtn = "";
                if (isMine && (Date.now() - m.timestamp <= 60000)) {
                    deleteBtn = `<span class="del-msg-btn" onclick="apagarMensagem('${msgKey}')" style="cursor:pointer; font-size:12px; margin-right:8px; opacity:0.5;">🗑️</span>`;
                }

                let content = "";
                if (m.type === 'image') {
                    content = `<img src="${m.text}" class="chat-img-msg" onclick="openFullImage('${m.text}')">`;
                } else if (m.type === 'video') {
                    content = `<video src="${m.text}" controls class="chat-img-msg"></video>`;
                } else if (m.type === 'audio') {
                    content = `<audio src="${m.text}" controls preload="metadata" style="max-width: 200px; height: 35px;"></audio>`;
                } else {
                    content = `<div class="msg-bubble" style="background:${isMine ? 'var(--primary)' : '#444'};">
                                <span>${m.text}</span>${readReceipt}
                            </div>`;
                }
                
                row.innerHTML = `
                    ${!isMine ? `<img src="${senderPhoto}" class="chat-avatar">` : ''}
                    <div class="msg-wrapper">
                        ${(isGroup && !isMine) ? `<span class="msg-name">${displayName}</span>` : ''}
                        <div style="display:flex; align-items:center;">
                            ${content}
                        </div>
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
            if (tipando.length > 0) {
                indicator.innerText = `${tipando[0]} está digitando...`;
                indicator.style.display = "block";
            } else { indicator.style.display = "none"; }
        });

    }).catch(err => console.error(err));
}

window.apagarMensagem = (key) => {
    if(confirm("Apagar mensagem?")) remove(ref(db, `chats/${activeChatId}/${key}`));
};

document.getElementById("backToProfile").onclick = () => {
    if (activeChatId && currentUser) {
        set(ref(db, `chats/${activeChatId}/typing/${currentUser}`), false);
    }
    activeChatId = null;
    if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
    if (statusUnsubscribe) { statusUnsubscribe(); statusUnsubscribe = null; }
    if (typingUnsubscribe) { typingUnsubscribe(); typingUnsubscribe = null; }
    showScreen("profile-screen");
};

// --- ENVIO DE MÍDIAS E TEXTO ---
async function sendMessage() {
    const texto = campoTexto.value.trim();
    if (texto !== "" && activeChatId) {
        try {
            await push(ref(db, "chats/" + activeChatId), {
                sender: currentUser,
                text: texto,
                type: 'text',
                timestamp: Date.now(),
                read: false
            });
            campoTexto.value = "";
            iconeBotao.innerText = "🎤";
            set(ref(db, `chats/${activeChatId}/typing/${currentUser}`), false); 
        } catch (e) {
            console.error("Erro ao enviar:", e);
        }
    }
}

async function handleAudio() {
    if (iconeBotao.innerText === "🎤") {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';

            mediaRecorder = new MediaRecorder(stream, { mimeType });
            audioChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunks.push(event.data);
            };

            mediaRecorder.onstop = async () => {
    const audioBlob = new Blob(audioChunks, { type: mimeType });
    audioChunks = [];

    if (!activeChatId || audioBlob.size < 100) return;

    // Convertendo o áudio em texto (Base64)
    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);
    reader.onloadend = async () => {
        const base64Audio = reader.result;

        try {
            await push(ref(db, `chats/${activeChatId}`), {
                sender: currentUser,
                text: base64Audio, // Enviamos o texto gigante do áudio direto pro banco
                type: 'audio',
                timestamp: Date.now(),
                read: false
            });
        } catch (error) {
            console.error("Erro ao enviar áudio:", error);
        }
    };
    
    if (stream) stream.getTracks().forEach(track => track.stop());
};

            mediaRecorder.start(); 
            iconeBotao.innerText = "⏹️"; 
            iconeBotao.style.color = "var(--danger)"; 
        } catch (err) {
            console.error("Erro de microfone:", err);
            alert("Permita o acesso ao microfone para gravar mensagens de áudio.");
        }
    } else {
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
        }
        iconeBotao.innerText = "🎤";
        iconeBotao.style.color = ""; 
    }
}

campoTexto.addEventListener("input", () => {
    iconeBotao.innerText = campoTexto.value.trim() !== "" ? "➤" : "🎤";

    if (activeChatId && currentUser) {
        set(ref(db, `chats/${activeChatId}/typing/${currentUser}`), true);
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            if(activeChatId) set(ref(db, `chats/${activeChatId}/typing/${currentUser}`), false);
        }, 2000);
    }
});

document.getElementById("actionBtn").onclick = (e) => {
    e.preventDefault(); 
    if (iconeBotao.innerText === "➤") sendMessage();
    else handleAudio();
};

document.getElementById("mediaInput").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file || !activeChatId) return;

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onloadend = async () => {
        const base64 = reader.result;
        
        try {
            await push(ref(db, `chats/${activeChatId}`), {
                sender: currentUser,
                text: base64,
                type: (file.type && file.type.startsWith('video')) ? 'video' : 'image',
                timestamp: Date.now(),
                read: false 
            });
            e.target.value = ''; 
        } catch (error) { 
            alert("Erro ao enviar arquivo.");
        }
    };
};

// --- AMIGOS, DMs E GRUPOS ---
document.getElementById("addFriendBtn").onclick = async () => {
    const f = document.getElementById("friendIdInput").value.trim().toLowerCase();
    if (!f || f === currentUser) return;
    const check = await get(ref(db, "users/" + f));
    if (check.exists()) {
        isGroup = false;
        activeChatId = [currentUser, f].sort().join("_");
        
        await remove(ref(db, `users/${currentUser}/hiddenDMs/${activeChatId}`));
        document.getElementById("deleteGroupBtn").style.display = "none";
        document.getElementById("addMemberBtn").style.display = "none";
        
        abrirChat(f);
    } else { alert("Usuário não encontrado!"); }
};

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

                    Object.keys(mensagens).forEach(k => {
                        if (k !== 'typing' && mensagens[k].sender !== currentUser && mensagens[k].read === false) {
                            unreadCount++;
                        }
                    });

                    if (hiddenDMs[chatId] && unreadCount === 0) return;

                    const amigo = chatId.replace(currentUser, "").replace("_", "");
                    const div = document.createElement("div");
                    div.style.cssText = "display:flex; align-items:center; gap:5px; margin-bottom:8px;";

                    const btn = document.createElement("button");
                    btn.className = "group-btn-list";
                    btn.style.flex = "1";
                    
                    const badgeHtml = unreadCount > 0 
                        ? `<span class="badge">${unreadCount > 10 ? '10+' : unreadCount}</span>` : "";

                    get(ref(db, `users/${amigo}`)).then(uSnap => {
                        const d = uSnap.val();
                        const foto = (d && d.photoUrl) ? d.photoUrl : "https://cdn-icons-png.flaticon.com/512/149/149071.png";
                        const nomeExibicao = (d && d.displayName) ? d.displayName : amigo;
                        btn.innerHTML = `
                            <img src="${foto}" style="width:28px; height:28px; border-radius:50%; object-fit:cover; vertical-align:middle;"> 
                            <span style="flex:1; text-align:left;">${nomeExibicao}</span>
                            ${badgeHtml}
                        `;
                    });

                    btn.onclick = () => { 
                        isGroup = false; 
                        activeChatId = chatId; 
                        abrirChat(amigo); 
                    };
                    const closeBtn = document.createElement("button");
                    closeBtn.innerHTML = "✖"; 
                    closeBtn.style.cssText = "background:var(--danger); padding:12px 15px; margin:0;";
                    closeBtn.onclick = async (e) => {
                        e.stopPropagation();
                        if (confirm("Deseja fechar esta conversa?")) {
                            await set(ref(db, `users/${currentUser}/hiddenDMs/${chatId}`), true);
                            loadDMs(); 
                        }
                    };

                    div.appendChild(btn); 
                    div.appendChild(closeBtn); 
                    list.appendChild(div);
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

                Object.keys(mensagensDoGrupo).forEach(k => {
                    if (k !== 'typing' && mensagensDoGrupo[k].sender !== currentUser && mensagensDoGrupo[k].read === false) unreadCount++;
                });

                const badgeHtml = unreadCount > 0 ? `<span class="badge">${unreadCount > 10 ? '10+' : unreadCount}</span>` : "";
                const btn = document.createElement("button");
                btn.className = "group-btn-list";
                const fotoGrupo = g.photoUrl || "https://cdn-icons-png.flaticon.com/512/149/149071.png";
                
                btn.innerHTML = `
                    <img src="${fotoGrupo}" style="width:28px; height:28px; border-radius:50%; object-fit:cover;"> 
                    <span style="flex:1;">${g.name}</span>
                    ${badgeHtml}
                `;
                
                btn.onclick = () => { 
                    isGroup = true; 
                    activeChatId = groupId; 
                    abrirChat(g.name); 
                };
                list.appendChild(btn);
            });
        });
    });
}

document.getElementById("createGroupBtn").onclick = async () => {
    const nome = document.getElementById("groupNameInput").value.trim();
    if (!nome) return;
    const gRef = push(ref(db, "groups"));
    await set(gRef, { name: nome, admin: currentUser, members: { [currentUser]: true } });
    document.getElementById("groupNameInput").value = "";
};

document.getElementById("deleteGroupBtn").onclick = async () => {
    if (!isGroup || !activeChatId) return;
    const snap = await get(ref(db, `groups/${activeChatId}`));
    if (!snap.exists()) { showScreen("profile-screen"); return; }

    const g = snap.val();
    const isAdmin = g.admin === currentUser;

    if (isAdmin) {
        if (confirm("Apagar este grupo para todos?")) {
            await remove(ref(db, `groups/${activeChatId}`));
            await remove(ref(db, `chats/${activeChatId}`));
            showScreen("profile-screen");
        }
    } else {
        if (confirm("Deseja sair deste grupo?")) {
            await remove(ref(db, `groups/${activeChatId}/members/${currentUser}`));
            showScreen("profile-screen");
        }
    }
};

document.getElementById("addMemberBtn").onclick = async () => {
    const novoMembro = prompt("Digite o login do usuário para adicionar:");
    if (!novoMembro) return;
    const userSnap = await get(ref(db, `users/${novoMembro.toLowerCase()}`));
    if (userSnap.exists()) {
        await update(ref(db, `groups/${activeChatId}/members`), { [novoMembro.toLowerCase()]: true });
        alert("Membro adicionado!");
    } else { alert("Usuário não encontrado."); }
};

const areaClique = document.getElementById("headerClickArea");
if (areaClique) {
    areaClique.onclick = () => {
        if (isGroup && activeChatId) abrirTelaGrupo();
    };
}

document.getElementById("closeGroupInfoBtn").onclick = () => document.getElementById("group-info-screen").style.display = "none";

function abrirTelaGrupo() {
    document.getElementById("group-info-screen").style.display = "block";
    onValue(ref(db, `groups/${activeChatId}`), async (snap) => {
        const g = snap.val();
        if (!g) return;

        document.getElementById("groupInfoName").innerText = g.name;
        document.getElementById("groupPhotoPreview").src = g.photoUrl || "https://cdn-icons-png.flaticon.com/512/149/149071.png";

        const souAdmin = (g.admin === currentUser) || (g.admins && g.admins[currentUser]);

        document.getElementById("editGroupNameBtn").style.display = souAdmin ? "block" : "none";
        document.getElementById("groupAddMemberDiv").style.display = souAdmin ? "block" : "none";
        document.getElementById("groupPhotoPreview").onclick = () => { if (souAdmin) document.getElementById("groupPhotoInput").click(); };

        document.getElementById("editGroupNameBtn").onclick = async () => {
            const novoNome = prompt("Novo nome do grupo:", g.name);
            if (novoNome && novoNome.trim() !== "") {
                await update(ref(db, `groups/${activeChatId}`), { name: novoNome });
                document.getElementById("chatWithTitle").innerText = novoNome;
            }
        };

        const membersList = document.getElementById("groupMembersList");
        membersList.innerHTML = "";
        const usersSnap = await get(ref(db, "users"));
        const allUsers = usersSnap.val() || {};

        Object.keys(g.members || {}).forEach(membro => {
            const isMembroAdmin = (g.admin === membro) || (g.admins && g.admins[membro]);
            const userData = allUsers[membro] || {};
            const foto = userData.photoUrl || "https://cdn-icons-png.flaticon.com/512/149/149071.png";
            const statusColor = userData.status === "online" ? "#2ecc71" : "#aaa";
            const statusText = userData.status === "online" ? "● Online" : "○ Offline";
            
            const div = document.createElement("div");
            div.style.cssText = "display:flex; align-items:center; text-align:left; background:var(--bg-light); padding:10px; border-radius:8px;";

            let botoesAdmin = "";
            if (souAdmin && membro !== currentUser) {
                botoesAdmin = `
                    <button onclick="promoverRebaixar('${membro}', ${isMembroAdmin})" style="background:${isMembroAdmin ? 'var(--warning)' : 'var(--primary)'}; font-size:10px; padding:5px; margin-left:auto;">
                        ${isMembroAdmin ? 'Remover Admin' : 'Dar Admin'}
                    </button>
                    <button onclick="removerDoGrupo('${membro}')" style="background:var(--danger); font-size:10px; padding:5px; margin-left:5px;">Expulsar</button>
                `;
            }

            div.innerHTML = `
                <img src="${foto}" style="width:35px; height:35px; border-radius:50%; object-fit:cover; margin-right:10px;">
                <div style="flex:1; display:flex; flex-direction:column; align-items:flex-start;"> 
                    <div style="display:flex; align-items:center;">
                        <span style="font-weight:bold; color: white;">${membro}</span>
                        ${isMembroAdmin ? '<span style="color:var(--success); font-size:11px; margin-left:5px;">(Admin)</span>' : ''}
                    </div>
                    <span style="color:${statusColor}; font-size:11px; margin-top:2px;">${statusText}</span>
                </div>
                ${botoesAdmin}
            `;
            membersList.appendChild(div);
        });
    });
}

document.getElementById("addNewGroupMemberBtn").onclick = async () => {
    const novo = document.getElementById("newGroupMemberInput").value.trim().toLowerCase();
    if (!novo) return;
    const userSnap = await get(ref(db, `users/${novo}`));
    if (userSnap.exists()) {
        await update(ref(db, `groups/${activeChatId}/members`), { [novo]: true });
        document.getElementById("newGroupMemberInput").value = "";
        alert("Usuário adicionado!");
    } else { alert("Usuário não existe!"); }
};

window.promoverRebaixar = async (membro, isJaAdmin) => {
    if (isJaAdmin) {
        if(confirm(`Tirar admin de ${membro}?`)) await remove(ref(db, `groups/${activeChatId}/admins/${membro}`));
    } else {
        if(confirm(`Dar admin para ${membro}?`)) await update(ref(db, `groups/${activeChatId}/admins`), { [membro]: true });
    }
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
    modalImg.src = src;
    modalImg.style.transform = "scale(1)";
    modal.style.display = "flex";
};

const alternarTema = () => {
    const isLight = document.body.classList.toggle("light-mode");
    localStorage.setItem("globalTheme", isLight ? "light" : "dark");
};

const btnTemaChat = document.getElementById("themeToggleBtn");
if (btnTemaChat) btnTemaChat.onclick = alternarTema;

const btnTemaPrincipal = document.getElementById("mainThemeToggleBtn");
if (btnTemaPrincipal) btnTemaPrincipal.onclick = alternarTema;

if(localStorage.getItem("globalTheme") === "light") document.body.classList.add("light-mode");

const colorPicker = document.getElementById("chatColorPicker");
if (colorPicker) {
    colorPicker.oninput = (e) => {
        const cor = e.target.value;
        if (activeChatId) {
            document.body.style.setProperty('--primary', cor);
            localStorage.setItem('chatColor_' + activeChatId, cor);
        }
    };
}

const wallpaperBtn = document.getElementById("wallpaperBtn");
if (wallpaperBtn) wallpaperBtn.onclick = () => document.getElementById("wallpaperInput").click();

function iniciarNotificacoesGlobais() {
    onValue(ref(db, "chats"), snap => {
        if (!currentUser) return;
        snap.forEach(chatSnap => {
            const chatId = chatSnap.key;
            if (chatId.includes('_') && !chatId.includes(currentUser)) return;
            if (chatId === activeChatId) return;
            const msgs = chatSnap.val();
            if (!msgs) return;
            const keys = Object.keys(msgs).filter(k => k !== 'typing');
            if (keys.length === 0) return;
            
            const lastKey = keys[keys.length - 1];
            const lastMsg = msgs[lastKey];

            if (lastMsg && lastMsg.sender !== currentUser) {
                const notifKey = `notificado_${lastKey}`;
                if (Date.now() - lastMsg.timestamp < 10000 && !localStorage.getItem(notifKey)) {
                    localStorage.setItem(notifKey, "true");
                    if ("Notification" in window && Notification.permission === "granted") {
                        new Notification(`Kimorococho - ${lastMsg.sender}`, { body: lastMsg.text || 'Nova mídia recebida' });
                    }
                }
            }
        });
    });
}