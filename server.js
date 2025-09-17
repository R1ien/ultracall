const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// maps
const users = new Map();         // code -> ws
const pendingCalls = new Map();  // calleeCode -> callerCode
const friendRequests = new Map(); // targetCode -> Set of pending requests
const friendships = new Map();    // code -> Set of friends

function safeSend(ws, obj){
  try { ws.send(JSON.stringify(obj)); } catch (e){ /* ignore */ }
}

// helper: renvoyer la liste d'amis
function sendFriendsList(code){
  const ws = users.get(code);
  if (!ws) return;
  const list = friendships.has(code) ? Array.from(friendships.get(code)) : [];
  safeSend(ws, { type:'friends-list', friends:list });
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch (e) { return; }

    const sender = (typeof data.from === 'string' && data.from.trim()) ? data.from.trim() : ws.code;

    // ---------------- REGISTER ----------------
    if (data.cmd === 'register') {
      const code = String(data.code || '').trim();
      if (!code) { safeSend(ws, { type: 'error', message: 'Code invalide' }); return; }
      if (ws.code && users.get(ws.code) === ws) users.delete(ws.code);
      ws.code = code;
      users.set(code, ws);
      if (!friendships.has(code)) friendships.set(code, new Set());
      safeSend(ws, { type: 'registered', code });
      // envoyer la liste d'amis au client qui vient de se connecter
      sendFriendsList(code);
      return;
    }

    // ---------------- FRIENDS LIST ----------------
    if (data.cmd === 'friends-list') {
      sendFriendsList(sender);
      return;
    }

    // ---------------- CALL ----------------
    if (data.cmd === 'call') {
      const target = String(data.target || '').trim();
      if (!target) { safeSend(ws, { type: 'error', message: 'Target missing' }); return; }
      const targetWs = users.get(target);
      if (!targetWs) { safeSend(ws, { type: 'error', message: 'Ami non connecté' }); return; }

      pendingCalls.set(target, sender);
      safeSend(targetWs, { type: 'incoming-call', from: sender });
      safeSend(ws, { type: 'call-placed', target });
      return;
    }

    if (data.cmd === 'answer') {
      const callee = ws.code;
      const callerCode = (typeof data.from === 'string' && data.from.trim()) ? data.from.trim() : pendingCalls.get(callee);
      if (!callerCode) { safeSend(ws, { type: 'error', message: 'Appel introuvable' }); return; }
      const callerWs = users.get(callerCode);
      if (!callerWs) { safeSend(ws, { type: 'error', message: 'Appelant déconnecté' }); pendingCalls.delete(callee); return; }

      safeSend(callerWs, { type: 'call-accepted', with: callee });
      safeSend(ws, { type: 'call-accepted', with: callerCode });
      pendingCalls.delete(callee);
      return;
    }

    if (data.cmd === 'reject') {
      const callee = ws.code;
      const callerCode = (typeof data.from === 'string' && data.from.trim()) ? data.from.trim() : pendingCalls.get(callee);
      if (callerCode) {
        const callerWs = users.get(callerCode);
        if (callerWs) safeSend(callerWs, { type: 'call-rejected', from: callee });
      }
      pendingCalls.delete(callee);
      return;
    }

    if (data.cmd === 'signal') {
      const target = String(data.target || '').trim();
      const payload = data.payload;
      if (!target || !payload) return;
      const targetWs = users.get(target);
      if (targetWs) safeSend(targetWs, { type: 'signal', payload, from: sender });
      return;
    }

    if (data.cmd === 'hangup') {
      const target = String(data.target || '').trim();
      if (!target) return;
      const targetWs = users.get(target);
      if (targetWs) safeSend(targetWs, { type: 'call-ended', from: sender });
      safeSend(ws, { type: 'call-ended', from: sender });
      for (const [callee, caller] of pendingCalls.entries()) {
        if (callee === target || caller === target || callee === sender || caller === sender) pendingCalls.delete(callee);
      }
      return;
    }

    // ---------------- FRIEND REQUEST ----------------
    if (data.cmd === 'friend-request') {
      const target = String(data.target || '').trim();
      if (!target) { safeSend(ws, { type: 'error', message: 'Cible manquante' }); return; }
      if (!friendRequests.has(target)) friendRequests.set(target, new Set());
      friendRequests.get(target).add(sender);
      const targetWs = users.get(target);
      if (targetWs) safeSend(targetWs, { type: 'friend-request', from: sender });
      return;
    }

    if (data.cmd === 'friend-accept') {
      const target = String(data.target || '').trim();
      if (!target) return;
      if (friendRequests.has(ws.code)) friendRequests.get(ws.code).delete(target);
      if (!friendships.has(ws.code)) friendships.set(ws.code, new Set());
      if (!friendships.has(target)) friendships.set(target, new Set());
      friendships.get(ws.code).add(target);
      friendships.get(target).add(ws.code);
      const targetWs = users.get(target);
      if (targetWs) safeSend(targetWs, { type: 'friend-accepted', from: ws.code });
      // mettre à jour la liste des deux côtés
      sendFriendsList(ws.code);
      sendFriendsList(target);
      return;
    }

    if (data.cmd === 'friend-reject') {
      const target = String(data.target || '').trim();
      if (!target) return;
      if (friendRequests.has(ws.code)) friendRequests.get(ws.code).delete(target);
      const targetWs = users.get(target);
      if (targetWs) safeSend(targetWs, { type: 'friend-rejected', from: ws.code });
      return;
    }

    // ---------------- MESSAGING ----------------
    if (data.cmd === 'message') {
      const target = String(data.target || '').trim();
      const message = String(data.message || '').trim();
      if (!target || !message) { safeSend(ws, { type:'error', message:'Target ou message manquant' }); return; }
      if (!friendships.has(sender) || !friendships.get(sender).has(target)) {
        safeSend(ws, { type:'error', message:'Vous n\'êtes pas ami avec cette personne' });
        return;
      }
      const targetWs = users.get(target);
      if (targetWs) safeSend(targetWs, { type:'message', from: sender, message });
      return;
    }

  });

  ws.on('close', () => {
    if (ws.code) {
      users.delete(ws.code);
      for (const [callee, caller] of pendingCalls.entries()) {
        if (caller === ws.code || callee === ws.code) pendingCalls.delete(callee);
      }
      friendRequests.delete(ws.code);
    }
  });
});

// static files
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Ultra Call server running on ${PORT}`));
