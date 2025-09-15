const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Stocker les utilisateurs par leur code d'ami
const users = {};

wss.on('connection', ws => {
  ws.on('message', msg => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    if(data.cmd === 'register'){
      ws.code = data.code;
      users[data.code] = ws;
      ws.send(JSON.stringify({type:'registered', code:data.code}));
    }

    else if(data.cmd === 'call'){
      const target = users[data.target];
      if(target){
        target.send(JSON.stringify({type:'incoming-call', from:ws.code}));
      }
    }

    else if(data.cmd === 'answer'){
      const target = users[data.from];
      if(target){
        target.send(JSON.stringify({type:'call-accepted', with:ws.code}));
      }
    }

    else if(data.cmd === 'reject'){
      const target = users[data.from];
      if(target){
        target.send(JSON.stringify({type:'call-rejected', from:ws.code}));
      }
    }

    else if(data.cmd === 'signal'){
      const target = users[data.target];
      if(target){
        target.send(JSON.stringify({type:'signal', payload:data.payload}));
      }
    }

    else if(data.cmd === 'hangup'){
      const target = users[data.target];
      if(target){
        target.send(JSON.stringify({type:'call-ended'}));
      }
    }
  });

  ws.on('close', ()=> {
    if(ws.code && users[ws.code]) delete users[ws.code];
  });
});

app.use(express.static(path.join(__dirname, 'public')));

server.listen(process.env.PORT || 3000, ()=>console.log('Ultra Call lancé 🚀'));
