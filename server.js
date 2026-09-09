const path=require('path');
const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const app=express(),server=http.createServer(app);
const io=new Server(server,{maxHttpBufferSize:12e6,pingTimeout:20000,pingInterval:10000});
app.use(express.static(path.join(__dirname,'public'),{extensions:['html']}));
const rooms=new Map(),CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROLES=['background','texture','stickers','copy','font','draw','paint','chaos','photo'];
function blankRoomState(){
 return {
  bg:{type:'solid',c1:'#ffffff',c2:'#ffffff',c3:'#ffffff',colors:1,angle:0},
  texture:{type:'none',opacity:0,scale:18,color:'#111111'},
  stickers:[],
  texts:[],
  strokes:[],
  photos:[],
  chaos:{glitch:0,warp:0,rgb:0,melt:0,echo:0,pixel:0,ripple:0,twist:0},
  draw:{size:22,opacity:100,color:'#101010'},
  paint:{material:'RUNDA',size:24,opacity:100,organic:0,swell:0,twist:0,sticky:0,jagged:0,color:'#101010'}
 };
}

const PHRASES=new Set(['JAG ÄR NÖJD','JAG ÄR INTE NÖJD','KÖR','VÄNTA','MER','MINDRE','BRA DÄR','SPARA DEN HÄR']);
const cleanRoom=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
const cleanName=v=>String(v||'ANONYM').replace(/[<>]/g,'').trim().slice(0,24)||'ANONYM';
function code(){for(let n=0;n<100;n++){let c='';for(let i=0;i<5;i++)c+=CHARS[Math.floor(Math.random()*CHARS.length)];if(!rooms.has(c))return c}return Date.now().toString(36).toUpperCase().slice(-6)}
function safe(v){try{let x=JSON.stringify(v);return x.length<10_000_000?JSON.parse(x):null}catch{return null}}
function list(c){let r=rooms.get(c);return r?[...r.people].map(([id,p])=>({id,name:p.name,role:p.role})):[]}
function availableRole(r){let used=new Set([...r.people.values()].map(p=>p.role));let a=ROLES.filter(x=>!used.has(x));return a[Math.floor(Math.random()*a.length)]}
function presence(c){io.to(c).emit('presence',list(c))}
function roleRequestPayload(r){
 if(!r.roleRequest)return null;
 const q=r.roleRequest;
 return {
  by:q.by,byName:q.byName,role:q.role,targetId:q.targetId||null,targetName:q.targetName||null,
  yes:q.yes.size,total:q.required.size,voters:[...q.voters]
 };
}
function finishRoleRequest(c,r){
 const q=r.roleRequest;
 if(!q)return;
 const requester=r.people.get(q.by);
 if(!requester){r.roleRequest=null;return}

 const oldRole=requester.role;
 const target=q.targetId?r.people.get(q.targetId):null;
 requester.role=q.role;
 if(target)target.role=oldRole;

 r.roleRequest=null;
 r.updated=Date.now();
 const people=list(c);
 io.to(c).emit('role-change-complete',{participants:people,by:q.by,role:q.role});
 presence(c);
}
function leave(socket){
 const c=socket.data.room;if(!c)return;
 const r=rooms.get(c);
 socket.leave(c);socket.data.room=null;
 if(r){
  r.people.delete(socket.id);
  if(r.roleRequest){
   const q=r.roleRequest;
   if(q.by===socket.id || q.targetId===socket.id){
    r.roleRequest=null;
    io.to(c).emit('role-request-cancelled',{byName:'SYSTEM'});
   }else{
    q.required.delete(socket.id);q.voters.delete(socket.id);q.yes.delete(socket.id);
    if(q.yes.size===q.required.size)finishRoleRequest(c,r);
    else io.to(c).emit('role-request-state',roleRequestPayload(r));
   }
  }
  presence(c);r.updated=Date.now();
 }
}
function mergeByRole(base,next,role){
 if(!base||!next)return next||base;
 if(role==='background')base.bg=next.bg;
 else if(role==='texture')base.texture=next.texture;
 else if(role==='stickers')base.stickers=next.stickers;
 else if(role==='draw'){base.draw=next.draw;base.strokes=next.strokes}
 else if(role==='paint')base.paint=next.paint;
 else if(role==='chaos')base.chaos=next.chaos;
 else if(role==='photo')base.photos=next.photos;
 else if(role==='copy'){
  base.texts=base.texts||[];for(let i=0;i<(next.texts||[]).length;i++){let n=next.texts[i],b=base.texts[i]||{};base.texts[i]={...b,text:n.text,size:n.size,color:n.color};}
  if((next.texts||[]).length!==base.texts.length)base.texts=next.texts;
 }else if(role==='font'){
  base.texts=base.texts||[];for(let i=0;i<(next.texts||[]).length;i++){let n=next.texts[i],b=base.texts[i]||{};base.texts[i]={...b,x:n.x,y:n.y,h:n.h,w:n.w,skew:n.skew,rot:n.rot,shadow:n.shadow,font:n.font};}
 }
 return base;
}
app.get('/health',(_q,res)=>res.json({ok:true,rooms:rooms.size}));
app.get('/r/:code',(q,res)=>res.redirect('/?room='+encodeURIComponent(cleanRoom(q.params.code))));
app.get('*',(_q,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
io.on('connection',socket=>{
 socket.on('create-room',({name}={},ack=()=>{})=>{leave(socket);let c=code(),r={state:blankRoomState(),people:new Map(),roleRequest:null,updated:Date.now()};rooms.set(c,r);let role=availableRole(r);r.people.set(socket.id,{name:cleanName(name),role});socket.join(c);socket.data.room=c;ack({ok:true,room:c,state:r.state,role,participants:list(c)});presence(c)});
 socket.on('join-room',({room,name}={},ack=()=>{})=>{let c=cleanRoom(room),r=rooms.get(c);if(!r)return ack({ok:false,error:'Rummet finns inte längre.'});if(r.people.size>=ROLES.length)return ack({ok:false,error:'Rummet är fullt (max 9 personer).'});leave(socket);let role=availableRole(r);r.people.set(socket.id,{name:cleanName(name),role});socket.join(c);socket.data.room=c;r.updated=Date.now();ack({ok:true,room:c,state:r.state,role,participants:list(c)});presence(c)});
 socket.on('request-role',({room,role}={},ack=()=>{})=>{
  const c=cleanRoom(room),r=rooms.get(c);
  if(socket.data.room!==c||!r)return ack({ok:false,error:'RUMMET FINNS INTE.'});
  if(r.roleRequest)return ack({ok:false,error:'EN ROLLFÖRFRÅGAN PÅGÅR REDAN.'});
  role=String(role||'');
  if(!ROLES.includes(role))return ack({ok:false,error:'OGILTIG ROLL.'});
  const requester=r.people.get(socket.id);
  if(!requester)return ack({ok:false,error:'DU FINNS INTE I RUMMET.'});
  if(requester.role===role)return ack({ok:false,error:'DU HAR REDAN DEN ROLLEN.'});

  const targetEntry=[...r.people.entries()].find(([id,p])=>id!==socket.id&&p.role===role);
  const targetId=targetEntry?.[0]||null;
  const targetName=targetEntry?.[1]?.name||null;

  if(r.people.size===1){
   requester.role=role;r.updated=Date.now();
   const people=list(c);
   ack({ok:true,direct:true,role,participants:people});
   io.to(c).emit('role-change-complete',{participants:people,by:socket.id,role});
   presence(c);
   return;
  }

  const required=new Set([...r.people.keys()].filter(id=>id!==socket.id));
  r.roleRequest={
   by:socket.id,byName:requester.name,role,targetId,targetName,
   required,yes:new Set(),voters:new Set()
  };
  ack({ok:true,direct:false});
  io.to(c).emit('role-request',roleRequestPayload(r));
 });
 socket.on('role-request-vote',({room,yes}={})=>{
  const c=cleanRoom(room),r=rooms.get(c),q=r?.roleRequest;
  if(socket.data.room!==c||!r||!q)return;
  if(!q.required.has(socket.id)||q.voters.has(socket.id))return;
  q.voters.add(socket.id);
  if(!yes){
   const p=r.people.get(socket.id);
   r.roleRequest=null;
   io.to(c).emit('role-request-cancelled',{byName:p?.name||'NÅGON'});
   return;
  }
  q.yes.add(socket.id);
  if(q.yes.size===q.required.size)finishRoleRequest(c,r);
  else io.to(c).emit('role-request-state',roleRequestPayload(r));
 });
 socket.on('activity',({room}={})=>{
  const c=cleanRoom(room),r=rooms.get(c);
  if(socket.data.room!==c||!r||!r.people.has(socket.id))return;
  socket.to(c).emit('activity',{id:socket.id});
 });
 socket.on('text-op',({room,index,fields}={})=>{
  const c=cleanRoom(room),r=rooms.get(c),p=r?.people.get(socket.id);
  if(socket.data.room!==c||!r||!p||!['copy','font'].includes(p.role))return;
  index=Number(index);
  if(!Number.isInteger(index)||index<0||index>=r.state.texts.length)return;
  const allowed=p.role==='copy'?['text','size','color']:['x','y','h','w','skew','rot','shadow','font'];
  const clean={};
  for(const k of allowed)if(Object.prototype.hasOwnProperty.call(fields||{},k))clean[k]=safe(fields[k]);
  Object.assign(r.state.texts[index],clean);
  r.updated=Date.now();
  socket.to(c).emit('state-op',{room:c,type:'text',index,fields:clean});
 });
 socket.on('stroke-add',({room,stroke}={})=>{
  const c=cleanRoom(room),r=rooms.get(c),p=r?.people.get(socket.id),st=safe(stroke);
  if(socket.data.room!==c||!r||p?.role!=='draw'||!st||!Array.isArray(st.points))return;
  r.state.strokes.push(st);r.updated=Date.now();
  socket.to(c).emit('state-op',{room:c,type:'stroke-add',stroke:st});
 });
 socket.on('strokes-replace',({room,strokes}={})=>{
  const c=cleanRoom(room),r=rooms.get(c),p=r?.people.get(socket.id),arr=safe(strokes);
  if(socket.data.room!==c||!r||p?.role!=='draw'||!Array.isArray(arr))return;
  r.state.strokes=arr;r.updated=Date.now();
  socket.to(c).emit('state-op',{room:c,type:'strokes-replace',strokes:arr});
 });
 socket.on('state-update',({room,state}={})=>{let c=cleanRoom(room),r=rooms.get(c);if(socket.data.room!==c||!r)return;let p=r.people.get(socket.id),n=safe(state);if(!p||!n)return;r.state=mergeByRole(r.state,n,p.role);r.updated=Date.now();socket.to(c).emit('room-state',{room:c,state:r.state,by:socket.id})});
 socket.on('reset-room',({room}={})=>{let c=cleanRoom(room),r=rooms.get(c);if(socket.data.room!==c||!r)return;r.state=blankRoomState();r.updated=Date.now();io.to(c).emit('room-state',{room:c,state:r.state,by:socket.id,reset:true})});
 socket.on('quick-chat',({room,phrase}={})=>{let c=cleanRoom(room),r=rooms.get(c);phrase=String(phrase||'').toUpperCase();if(socket.data.room!==c||!r||!PHRASES.has(phrase))return;let p=r.people.get(socket.id);io.to(c).emit('quick-chat',{name:p.name,phrase})});
 socket.on('leave-room',()=>leave(socket));socket.on('disconnect',()=>leave(socket));
});
setInterval(()=>{let n=Date.now();for(let[c,r]of rooms)if(!r.people.size&&n-r.updated>6*60*60*1000)rooms.delete(c)},60000).unref();
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('KOLLEKTIV / POSTER K/P V2'));
