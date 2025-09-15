// server.js
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

function safeSend(ws, obj){
  try { ws.send(JSON.stringify(obj)); } catch (e){ /* ignore */ }
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch (e) { return; }

    // register (client announces its friend-code)
    if (data.cmd === 'register') {
      const code = String(data.code || '').trim();
      if (!code) { safeSend(ws, { type: 'error', message: 'Code invalide' }); return; }
      // remove older mapping if necessary
      if (ws.code && users.get(ws.code) === ws) users.delete(ws.code);
      ws.code = code;
      users.set(code, ws);
      safeSend(ws, { type: 'registered', code });
      return;
    }

    // helper to get who is sending (prefer explicit field, otherwise ws.code)
    const sender = (typeof data.from === 'string' && data.from.trim()) ? data.from.trim() : ws.code;

    // call
    if (data.cmd === 'call') {
      const target = String(data.target || '').trim();
      if (!target) { safeSend(ws, { type: 'error', message: 'Target missing' }); return; }
      const targetWs = users.get(target);
      if (!targetWs) { safeSend(ws, { type: 'error', message: 'Ami non connecté' }); return; }

      // save pending: callee (target) is being called by sender
      pendingCalls.set(target, sender);
      safeSend(targetWs, { type: 'incoming-call', from: sender });
      // optional ack to caller
      safeSend(ws, { type: 'call-placed', target });
      return;
    }

    // answer (callee notifies server it answered) - data.from should be caller code OR server can lookup pending
    if (data.cmd === 'answer') {
      // callee is ws
      const callee = ws.code;
      const callerCode = (typeof data.from === 'string' && data.from.trim()) ? data.from.trim() : pendingCalls.get(callee);
      if (!callerCode) { safeSend(ws, { type: 'error', message: 'Appel introuvable' }); return; }
      const callerWs = users.get(callerCode);
      if (!callerWs) { safeSend(ws, { type: 'error', message: 'Appelant déconnecté' }); pendingCalls.delete(callee); return; }

      // tell caller to start (caller will create offer)
      safeSend(callerWs, { type: 'call-accepted', with: callee });
      // optionally acknowledge callee
      safeSend(ws, { type: 'call-accepted', with: callerCode });
      // clear pending
      pendingCalls.delete(callee);
      return;
    }

    // reject
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

    // signal (forward sdp / ice)
    if (data.cmd === 'signal') {
      const target = String(data.target || '').trim();
      const payload = data.payload;
      if (!target || !payload) return;
      const targetWs = users.get(target);
      if (targetWs) {
        // forward plus who sent it
        safeSend(targetWs, { type: 'signal', payload, from: sender });
      }
      return;
    }

    // hangup -> notify target
    if (data.cmd === 'hangup') {
      const target = String(data.target || '').trim();
      if (!target) return;
      const targetWs = users.get(target);
      if (targetWs) safeSend(targetWs, { type: 'call-ended', from: sender });
      // also notify caller back (optional)
      safeSend(ws, { type: 'call-ended', from: sender });
      // cleanup pending entries referencing either side
      for (const [callee, caller] of pendingCalls.entries()) {
        if (callee === target || caller === target || callee === sender || caller === sender) pendingCalls.delete(callee);
      }
      return;
    }
  });

  ws.on('close', () => {
    // cleanup user and pending calls
    if (ws.code) {
      users.delete(ws.code);
      // remove pending where caller==ws.code or callee==ws.code
      for (const [callee, caller] of pendingCalls.entries()) {
        if (caller === ws.code || callee === ws.code) pendingCalls.delete(callee);
      }
    }
  });
});

// static files
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Ultra Call server running on ${PORT}`));
