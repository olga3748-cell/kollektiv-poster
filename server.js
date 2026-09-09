const path=require('path');
const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const app=express(),server=http.createServer(app);
const io=new Server(server,{maxHttpBufferSize:12e6,pingTimeout:20000,pingInterval:10000});
app.use(express.static(path.join(__dirname,'public'),{extensions:['html']}));
const rooms=new Map(),CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROLES=['background','texture','stickers','text','draw','photo'];
const PHRASES=new Set(['JAG ÄR NÖJD','JAG ÄR INTE NÖJD','MER!','MINDRE!','SPARA DEN HÄR','VÄNTA']);
const cleanRoom=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
const cleanName=v=>String(v||'ANONYM').replace(/[<>]/g,'').trim().slice(0,24)||'ANONYM';
function code(){for(let n=0;n<100;n++){let c='';for(let i=0;i<5;i++)c+=CHARS[Math.floor(Math.random()*CHARS.length)];if(!rooms.has(c))return c}return Date.now().toString(36).toUpperCase().slice(-6)}
function safe(v){try{let x=JSON.stringify(v);return x.length<10_000_000?JSON.parse(x):null}catch{return null}}
function list(c){let r=rooms.get(c);return r?[...r.people].map(([id,p])=>({id,name:p.name,role:p.role})):[]}
function availableRole(r){let used=new Set([...r.people.values()].map(p=>p.role));let a=ROLES.filter(x=>!used.has(x));return a[Math.floor(Math.random()*a.length)]}
function presence(c){io.to(c).emit('presence',list(c))}
function votePayload(r){return r.vote?{by:r.vote.by,byName:r.vote.byName,yes:r.vote.yes.size,total:r.people.size,voters:[...r.vote.voters]}:null}
function leave(socket){let c=socket.data.room;if(!c)return;let r=rooms.get(c);socket.leave(c);socket.data.room=null;if(r){r.people.delete(socket.id);if(r.vote){r.vote.voters.delete(socket.id);r.vote.yes.delete(socket.id);if(r.vote.yes.size===r.people.size&&r.people.size)shuffle(c,r);else io.to(c).emit('role-vote-state',votePayload(r))}presence(c);r.updated=Date.now()}}
function shuffle(c,r){
 let ids=[...r.people.keys()],old=ids.map(id=>r.people.get(id).role),next=[];
 for(let tries=0;tries<100;tries++){next=[...ROLES].sort(()=>Math.random()-.5).slice(0,ids.length);if(ids.length===1||next.every((x,i)=>x!==old[i]))break}
 ids.forEach((id,i)=>r.people.get(id).role=next[i]);r.vote=null;
 let people=list(c);io.to(c).emit('roles-shuffled',{participants:people});presence(c);
}
function mergeByRole(base,next,role){
 if(!base||!next)return next||base;
 if(role==='background')base.bg=next.bg;
 else if(role==='texture')base.texture=next.texture;
 else if(role==='stickers')base.stickers=next.stickers;
 else if(role==='draw'){base.draw=next.draw;base.paint=next.paint;base.strokes=next.strokes}
 else if(role==='photo')base.photos=next.photos;
 else if(role==='text')base.texts=next.texts;
 return base;
}
app.get('/health',(_q,res)=>res.json({ok:true,rooms:rooms.size}));
app.get('/r/:code',(q,res)=>res.redirect('/?room='+encodeURIComponent(cleanRoom(q.params.code))));
app.get('*',(_q,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
io.on('connection',socket=>{
 socket.on('create-room',({name,state}={},ack=()=>{})=>{leave(socket);let c=code(),r={state:safe(state),people:new Map(),vote:null,updated:Date.now()};rooms.set(c,r);let role=availableRole(r);r.people.set(socket.id,{name:cleanName(name),role});socket.join(c);socket.data.room=c;ack({ok:true,room:c,state:r.state,role,participants:list(c)});presence(c)});
 socket.on('join-room',({room,name}={},ack=()=>{})=>{let c=cleanRoom(room),r=rooms.get(c);if(!r)return ack({ok:false,error:'Rummet finns inte längre.'});if(r.people.size>=ROLES.length)return ack({ok:false,error:'Rummet är fullt (max 6 personer).'});leave(socket);let role=availableRole(r);r.people.set(socket.id,{name:cleanName(name),role});socket.join(c);socket.data.room=c;r.updated=Date.now();ack({ok:true,room:c,state:r.state,role,participants:list(c)});presence(c)});
 socket.on('state-update',({room,state}={})=>{let c=cleanRoom(room),r=rooms.get(c);if(socket.data.room!==c||!r)return;let p=r.people.get(socket.id),n=safe(state);if(!p||!n)return;r.state=mergeByRole(r.state,n,p.role);r.updated=Date.now();io.to(c).emit('room-state',{room:c,state:r.state,by:socket.id})});
 socket.on('propose-role-shuffle',({room}={})=>{let c=cleanRoom(room),r=rooms.get(c);if(socket.data.room!==c||!r||r.vote)return;let p=r.people.get(socket.id);r.vote={by:socket.id,byName:p.name,yes:new Set([socket.id]),voters:new Set([socket.id])};io.to(c).emit('role-vote-request',votePayload(r));if(r.people.size===1)shuffle(c,r)});
 socket.on('role-vote',({room,yes}={})=>{let c=cleanRoom(room),r=rooms.get(c);if(socket.data.room!==c||!r?.vote||r.vote.voters.has(socket.id))return;r.vote.voters.add(socket.id);if(!yes){let p=r.people.get(socket.id);r.vote=null;io.to(c).emit('role-vote-cancelled',{byName:p?.name||'NÅGON'});return}r.vote.yes.add(socket.id);if(r.vote.yes.size===r.people.size)shuffle(c,r);else io.to(c).emit('role-vote-state',votePayload(r))});
 socket.on('quick-chat',({room,phrase}={})=>{let c=cleanRoom(room),r=rooms.get(c);phrase=String(phrase||'').toUpperCase();if(socket.data.room!==c||!r||!PHRASES.has(phrase))return;let p=r.people.get(socket.id);io.to(c).emit('quick-chat',{name:p.name,phrase})});
 socket.on('activity',({room,action}={})=>{let c=cleanRoom(room),r=rooms.get(c);if(socket.data.room!==c||!r)return;let p=r.people.get(socket.id);socket.to(c).emit('activity',{name:p?.name||'NÅGON',action:String(action||'JOBBAR').slice(0,40)})});
 socket.on('leave-room',()=>leave(socket));socket.on('disconnect',()=>leave(socket));
});
setInterval(()=>{let n=Date.now();for(let[c,r]of rooms)if(!r.people.size&&n-r.updated>6*60*60*1000)rooms.delete(c)},60000).unref();
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('KOLLEKTIV / POSTER V4'));
