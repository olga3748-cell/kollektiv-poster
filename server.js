const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 12e6,
  pingTimeout: 20000,
  pingInterval: 10000
});

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const rooms = new Map();
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROLES = ['background','texture','stickers','copy','font','draw','paint','chaos','photo'];
const PHRASES = new Set(['JAG ÄR NÖJD','JAG ÄR INTE NÖJD','MER!','MINDRE!','SPARA DEN HÄR','VÄNTA','HAHA','BYT ROLL?']);

function cleanRoom(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8)}
function cleanName(v){return String(v||'ANONYM').replace(/[<>]/g,'').trim().slice(0,24)||'ANONYM'}
function roomCode(){
  for(let tries=0;tries<100;tries++){
    let code='';for(let i=0;i<5;i++)code+=codeChars[Math.floor(Math.random()*codeChars.length)];
    if(!rooms.has(code))return code;
  }
  return Date.now().toString(36).toUpperCase().slice(-6);
}
function safeState(v){
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  try{const json=JSON.stringify(v);if(json.length>10_000_000)return null;return JSON.parse(json)}catch{return null}
}
function participantList(code){
  const r=rooms.get(code);if(!r)return[];
  return [...r.participants.entries()].map(([id,p])=>({id,name:p.name,role:p.role}));
}
function touch(code){const r=rooms.get(code);if(r)r.updatedAt=Date.now()}
function broadcastPresence(code){io.to(code).emit('presence',participantList(code))}
function shuffledRoles(participants, avoidSame=true){
  const ids=[...participants.keys()], bag=[];
  while(bag.length<ids.length){
    const cycle=[...ROLES].sort(()=>Math.random()-.5);
    bag.push(...cycle);
  }
  const old=ids.map(id=>participants.get(id).role);
  let next=bag.slice(0,ids.length);
  if(avoidSame && ids.length>1){
    for(let tries=0;tries<30 && next.some((r,i)=>r===old[i]);tries++)next.sort(()=>Math.random()-.5);
    if(next.some((r,i)=>r===old[i]))next=next.map((_,i)=>bag[(i+1)%bag.length]);
  }
  ids.forEach((id,i)=>participants.get(id).role=next[i]);
}
function leastUsedRole(participants){
  const counts=Object.fromEntries(ROLES.map(r=>[r,0]));
  for(const p of participants.values())counts[p.role]=(counts[p.role]||0)+1;
  const min=Math.min(...ROLES.map(r=>counts[r]));
  const candidates=ROLES.filter(r=>counts[r]===min);
  return candidates[Math.floor(Math.random()*candidates.length)];
}
function detach(socket){
  const code=socket.data.room;if(!code)return;
  const r=rooms.get(code);socket.leave(code);socket.data.room=null;
  if(r){
    r.participants.delete(socket.id);
    if(r.vote){
      r.vote.voters.delete(socket.id);
      if(r.participants.size===0)r.vote=null;
      else io.to(code).emit('role-vote-state',votePayload(r));
    }
    touch(code);broadcastPresence(code);
  }
}
function votePayload(r){
  if(!r.vote)return null;
  return {by:r.vote.by,byName:r.vote.byName,yes:r.vote.yes.size,total:r.participants.size,voters:[...r.vote.voters]};
}
function completeShuffle(code,r){
  shuffledRoles(r.participants,true);
  r.vote=null;touch(code);
  const participants=participantList(code);
  io.to(code).emit('roles-shuffled',{participants});
  broadcastPresence(code);
}

app.get('/health',(_req,res)=>res.json({ok:true,rooms:rooms.size}));
app.get('/api/room/:code',(req,res)=>{
  const code=cleanRoom(req.params.code),r=rooms.get(code);
  res.json({ok:!!r,room:code,participants:r?r.participants.size:0});
});
app.get('/r/:code',(req,res)=>res.redirect('/?room='+encodeURIComponent(cleanRoom(req.params.code))));
app.get('*',(_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

io.on('connection',socket=>{
  socket.on('create-room',({name,state}={},ack=()=>{})=>{
    try{
      detach(socket);
      const code=roomCode();
      rooms.set(code,{state:safeState(state),participants:new Map(),vote:null,createdAt:Date.now(),updatedAt:Date.now()});
      const r=rooms.get(code),role=leastUsedRole(r.participants);
      r.participants.set(socket.id,{name:cleanName(name),role});
      socket.join(code);socket.data.room=code;
      ack({ok:true,room:code,state:r.state,role,participants:participantList(code)});
      broadcastPresence(code);
    }catch(e){console.error(e);ack({ok:false,error:'Kunde inte skapa rummet.'})}
  });

  socket.on('join-room',({room,name}={},ack=()=>{})=>{
    try{
      const code=cleanRoom(room),r=rooms.get(code);
      if(!r)return ack({ok:false,error:'Rummet finns inte längre.'});
      detach(socket);
      const role=leastUsedRole(r.participants);
      r.participants.set(socket.id,{name:cleanName(name),role});
      socket.join(code);socket.data.room=code;touch(code);
      ack({ok:true,room:code,state:r.state,role,participants:participantList(code)});
      broadcastPresence(code);
    }catch(e){console.error(e);ack({ok:false,error:'Kunde inte gå med i rummet.'})}
  });

  socket.on('state-update',({room,state}={})=>{
    const code=cleanRoom(room);if(socket.data.room!==code)return;
    const r=rooms.get(code);if(!r)return;
    const next=safeState(state);if(!next)return;
    r.state=next;touch(code);socket.to(code).emit('room-state',{room:code,state:next,by:socket.id});
  });

  socket.on('propose-role-shuffle',({room}={})=>{
    const code=cleanRoom(room),r=rooms.get(code);
    if(socket.data.room!==code||!r||r.vote)return;
    const proposer=r.participants.get(socket.id);if(!proposer)return;
    r.vote={by:socket.id,byName:proposer.name,yes:new Set([socket.id]),no:new Set(),voters:new Set([socket.id])};
    const payload=votePayload(r);
    io.to(code).emit('role-vote-request',payload);
    if(r.participants.size===1)completeShuffle(code,r);
  });

  socket.on('role-vote',({room,yes}={})=>{
    const code=cleanRoom(room),r=rooms.get(code);
    if(socket.data.room!==code||!r?.vote||!r.participants.has(socket.id))return;
    if(r.vote.voters.has(socket.id))return;
    r.vote.voters.add(socket.id);
    if(yes)r.vote.yes.add(socket.id);else r.vote.no.add(socket.id);
    if(!yes){
      const p=r.participants.get(socket.id);
      r.vote=null;
      io.to(code).emit('role-vote-cancelled',{byName:p?.name||'NÅGON'});
      return;
    }
    if(r.vote.yes.size===r.participants.size){completeShuffle(code,r);return}
    io.to(code).emit('role-vote-state',votePayload(r));
  });

  socket.on('quick-chat',({room,phrase}={})=>{
    const code=cleanRoom(room),r=rooms.get(code);
    if(socket.data.room!==code||!r)return;
    phrase=String(phrase||'').toUpperCase();
    if(!PHRASES.has(phrase))return;
    const p=r.participants.get(socket.id);if(!p)return;
    io.to(code).emit('quick-chat',{id:socket.id,name:p.name,phrase});
  });

  socket.on('activity',({room,action}={})=>{
    const code=cleanRoom(room),r=rooms.get(code);
    if(socket.data.room!==code||!r)return;
    const p=r.participants.get(socket.id);if(!p)return;
    socket.to(code).emit('activity',{id:socket.id,name:p.name,action:String(action||'JOBBAR').slice(0,50)});
  });

  socket.on('leave-room',()=>detach(socket));
  socket.on('disconnect',()=>detach(socket));
});

setInterval(()=>{
  const now=Date.now();
  for(const [code,r] of rooms)if(r.participants.size===0&&now-r.updatedAt>ROOM_TTL_MS)rooms.delete(code);
},60_000).unref();

const port=Number(process.env.PORT||3000);
server.listen(port,'0.0.0.0',()=>console.log(`KOLLEKTIV / POSTER V3 listening on ${port}`));
