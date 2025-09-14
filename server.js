const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

const users = {}; // { code: ws }

wss.on('connection', ws => {
  ws.on('message', message => {
    let data;
    try{ data = JSON.parse(message); }catch{ return; }
    const { cmd, code, target, from, payload } = data;

    if(cmd==='register'){
      ws.code = code;
      users[code] = ws;
      ws.send(JSON.stringify({type:'registered', code}));
    }
    else if(cmd==='call'){
      if(users[target]){
        users[target].send(JSON.stringify({type:'incoming-call', from:ws.code}));
      } else { ws.send(JSON.stringify({type:'call-rejected'})); }
    }
    else if(cmd==='answer'){
      if(users[from]) users[from].send(JSON.stringify({type:'call-accepted', with:ws.code}));
    }
    else if(cmd==='hangup'){
      if(users[from]) users[from].send(JSON.stringify({type:'hangup'}));
    }
    else if(cmd==='mute'){
      if(users[from]) users[from].send(JSON.stringify({type:'mute', muted:data.muted}));
    }
    else if(cmd==='signal'){
      if(users[target]) users[target].send(JSON.stringify({type:'signal', payload}));
    }
  });

  ws.on('close', ()=>{
    if(ws.code) delete users[ws.code];
  });
});

console.log("Serveur WS lancé sur ws://localhost:8080");
