const express = require('express');
const app = express();
const http = require('http').createServer(app);
const WebSocket = require('ws');
const wss = new WebSocket.Server({ server: http });

const clients = {}; // code -> ws

app.use(express.static('public'));

wss.on('connection', ws => {
  ws.on('message', msg => {
    const data = JSON.parse(msg);

    if(data.cmd === 'register'){
      ws.myCode = data.code;
      clients[data.code] = ws;
      ws.send(JSON.stringify({ type: 'registered', code: data.code }));
    }

    if(data.cmd === 'call'){
      const target = clients[data.target];
      if(target) target.send(JSON.stringify({ type: 'incoming-call', from: ws.myCode }));
    }

    if(data.cmd === 'answer'){
      const target = clients[data.from];
      if(target) target.send(JSON.stringify({ type: 'call-accepted', with: ws.myCode }));
    }

    if(data.cmd === 'reject'){
      const target = clients[data.from];
      if(target) target.send(JSON.stringify({ type: 'call-rejected', from: ws.myCode }));
    }

    if(data.cmd === 'mute'){
      const target = clients[data.target];
      if(target){
        target.send(JSON.stringify({ type: 'mute-status', from: ws.myCode, muted: data.muted }));
      }
    }

    if(data.cmd === 'hangup'){
      const target = clients[data.target];
      if(target){
        target.send(JSON.stringify({ type: 'hangup', from: ws.myCode }));
      }
    }

    if(data.cmd === 'signal'){
      const target = clients[data.target];
      if(target){
        target.send(JSON.stringify({ type:'signal', payload: data.payload }));
      }
    }
  });

  ws.on('close', ()=>{
    if(ws.myCode) delete clients[ws.myCode];
  });
});

http.listen(8080, ()=>console.log('Serveur lancé sur http://localhost:8080'));

