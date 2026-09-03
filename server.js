const http=require('http'),fs=require('fs'),path=require('path');const WebSocket=require('ws');
const PORT=process.env.PORT||10000,PUBLIC=path.join(__dirname,'public');
const ROLES=[{id:1,name:'BAKGRUND'},{id:2,name:'TEXTUR'},{id:3,name:'STICKERS'},{id:4,name:'COPYWRITER'},{id:5,name:'TYPSNITT'},{id:6,name:'TECKNA'},{id:7,name:'PAINTBRUSH'},{id:8,name:'CHAOS'},{id:9,name:'FOTOGRAF'}];
let nextClient=1,nextSticker=1,nextText=2,nextProposal=1,nextLayer=2;
const clients=new Map(),roomState=new Map(),roomMeta=new Map(),proposals=new Map();
function initialState(){
 return {
  bg:{mode:'gradient',colorA:'#101010',colorB:'#5a416f',angle:135},
  texture:{type:'noise',opacity:.1,color:'#fff',scale:18},
  stickers:[],
  textLayers:[{id:1,value:'COLLECTIVE SIGNAL',x:50,y:15,color:'#fff',size:42,shadow:true,font:'Arial',weight:'700',height:100,width:100,skew:0}],
  type:{font:'Arial',weight:'700',height:100,width:100,skew:0},
  draw:{color:'#fff',activeLayer:1,layers:[{id:1,name:'TECKNING 1',color:'#fff',strokes:[]} ]},
  brush:{size:8,opacity:.8,type:'soft',jitter:0,spacing:1},
  chaos:{amount:0,mode:'glitch',frequency:5,glow:0},
  photos:[]
 }
}
function getState(room){if(!roomState.has(room))roomState.set(room,initialState());return roomState.get(room)}
const send=(w,x)=>w.readyState===WebSocket.OPEN&&w.send(JSON.stringify(x));
const roomClients=room=>[...clients.entries()].filter(([,c])=>c.room===room);
const broadcast=(room,x)=>roomClients(room).forEach(([w])=>send(w,x));
const presence=room=>roomClients(room).map(([,c])=>({id:c.id,role:c.role,room:c.room}));
const taken=(r,e,room)=>roomClients(room).some(([w,c])=>w!==e&&c.role===r);
function assign(w,r,room){
 const free=ROLES.filter(x=>!taken(x.id,w,room));
 if(r&&free.some(x=>x.id===r)) return r;
 return free.length?free[Math.floor(Math.random()*free.length)].id:null
}
function prop(room){let p=proposals.get(room);if(!p)return null;const members=roomClients(room).map(([,x])=>({id:x.id,role:x.role}));return {id:p.id,requester:p.requester,requestedRole:p.requestedRole,approvals:[...p.approvals],total:members.length,members}}
function resetProposal(room){if(proposals.has(room)){proposals.delete(room);broadcast(room,{type:'roleProposal',proposal:null})}}
function finishProposal(room){const p=proposals.get(room);if(!p)return false;const members=roomClients(room).map(([,x])=>x);if(!members.length){resetProposal(room);return false}if(!members.every(x=>p.approvals.has(x.id)))return false;const a=members.find(x=>x.id===p.requester);if(!a){resetProposal(room);return false}const b=members.find(x=>x.role===p.requestedRole);if(b){const old=a.role;a.role=b.role;b.role=old}else a.role=p.requestedRole;proposals.delete(room);roomClients(room).forEach(([w,x])=>send(w,{type:'roleChanged',role:x.role,clients:presence(room)}));broadcast(room,{type:'roleProposal',proposal:null});return true}
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://'+req.headers.host);if(u.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,clients:clients.size}))}let f=u.pathname==='/'?'/index.html':u.pathname,p=path.normalize(path.join(PUBLIC,f));if(!p.startsWith(PUBLIC))return res.end('Forbidden');fs.readFile(p,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'Content-Type':p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css; charset=utf-8':'application/octet-stream','Cache-Control':'no-cache'});res.end(d)})});
const wss=new WebSocket.Server({server,path:'/ws'});
wss.on('connection',ws=>{const c={id:nextClient++,role:null,room:null};clients.set(ws,c);send(ws,{type:'hello',clientId:c.id,roles:ROLES});
 ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return};
  if(m.type==='join'){c.room=String(m.room||'MAIN').trim().slice(0,40)||'MAIN';const state=getState(c.room);getMeta(c.room);c.role=assign(ws,Number(m.requestedRole)||null,c.room);send(ws,{type:'joined',role:c.role,state,proposal:prop(c.room),clients:presence(c.room)});broadcast(c.room,{type:'presence',clients:presence(c.room)});if(proposals.has(c.room))broadcast(c.room,{type:'roleProposal',proposal:prop(c.room)});return}
  if(!c.room)return;const room=c.room,state=getState(room);
  if(m.type==='roleRequest'){const r=Number(m.requestedRole);if(!ROLES.some(x=>x.id===r)||r===c.role)return;if(proposals.has(room)){const existing=proposals.get(room);const ids=new Set(roomClients(room).map(([,x])=>x.id));if(existing && existing.requester && ids.has(existing.requester)){return}proposals.delete(room)}const proposal={id:nextProposal++,requester:c.id,requestedRole:r,approvals:new Set([c.id])};proposals.set(room,proposal);broadcast(room,{type:'roleProposal',proposal:prop(room)});finishProposal(room);setTimeout(()=>{const current=proposals.get(room);if(current&&current.id===proposal.id)resetProposal(room)},120000);return}
  if(m.type==='roleApprove'){const p=proposals.get(room);if(!p||Number(m.proposalId)!==p.id)return;if(!roomClients(room).some(([,x])=>x.id===c.id))return;p.approvals.add(c.id);if(!finishProposal(room))broadcast(room,{type:'roleProposal',proposal:prop(room)});return}
  if(m.type==='roleCancel'&&proposals.get(room)?.requester===c.id){resetProposal(room);return}
  if(m.type==='ping'){send(ws,{type:'pong',t:Date.now()});return}
  const allowed={1:['bg'],2:['texture'],3:['stickers'],4:['textLayers'],5:['type'],6:['draw'],7:['brush'],8:['chaos'],9:['photos']};
  if(m.type==='set'){let k=String(m.key||'');if(!(allowed[c.role]||[]).includes(k))return;state[k]=Array.isArray(m.value)?m.value.slice(0,80):{...state[k],...m.value};broadcast(room,{type:'state',key:k,value:state[k]});return}
  if(m.type==='addSticker'&&c.role===3){state.stickers.push({id:nextSticker++,shape:['star','heart','circle','square','spiral'].includes(m.shape)?m.shape:'star',x:50,y:50,size:90,color:'#fff'});broadcast(room,{type:'state',key:'stickers',value:state.stickers});return}
  if(m.type==='removeSticker'&&c.role===3){state.stickers=state.stickers.filter(x=>x.id!==Number(m.id));broadcast(room,{type:'state',key:'stickers',value:state.stickers});return}
  if(m.type==='addText'&&c.role===4){state.textLayers.push({id:nextText++,value:'NY TEXT',x:50,y:25,color:'#fff',size:42,shadow:true,font:'Arial',weight:'700',height:100,width:100,skew:0});broadcast(room,{type:'state',key:'textLayers',value:state.textLayers});return}
  if(m.type==='removeText'&&c.role===4){state.textLayers=state.textLayers.filter(x=>x.id!==Number(m.id));broadcast(room,{type:'state',key:'textLayers',value:state.textLayers});return}
  if(m.type==='addDrawLayer'&&c.role===6){
    const name=String(m.name||'TECKNING '+(state.draw.layers.length+1)).slice(0,40);
    state.draw.layers.push({id:nextLayer++,name,color:'#fff',strokes:[]});
    broadcast(room,{type:'state',key:'draw',value:state.draw});return
  }
  if(m.type==='removeDrawLayer'&&c.role===6){
    if(state.draw.layers.length<=1)return;
    state.draw.layers=state.draw.layers.filter(x=>x.id!==Number(m.id));
    if(!state.draw.layers.some(x=>x.id===state.draw.activeLayer))state.draw.activeLayer=state.draw.layers[0].id;
    broadcast(room,{type:'state',key:'draw',value:state.draw});return
  }
  if(m.type==='stroke'&&c.role===6&&Array.isArray(m.points)){
    let pts=m.points.slice(0,900).map(p=>({x:+p.x,y:+p.y})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
    let layer=state.draw.layers.find(x=>x.id===Number(m.layerId))||state.draw.layers[0];
    if(pts.length>1){
      let st={points:pts,color:String(m.color||layer.color||'#fff')};
      layer.strokes.push(st);
      if(layer.strokes.length>4000)layer.strokes.shift();
      broadcast(room,{type:'stroke',layerId:layer.id,stroke:st})
    }
    return
  }
  if(m.type==='clear'&&c.role===6){
    if(m.all) state.draw.layers.forEach(l=>l.strokes=[]);
    else {
      let layer=state.draw.layers.find(x=>x.id===Number(m.layerId))||state.draw.layers[0];
      layer.strokes=[];
    }
    broadcast(room,{type:'state',key:'draw',value:state.draw});return
  }
 });
 ws.on('close',()=>{const room=c.room;clients.delete(ws);if(room){const p=proposals.get(room);if(p){p.approvals.delete(c.id);if(p.requester===c.id)resetProposal(room);else broadcast(room,{type:'roleProposal',proposal:prop(room)})}broadcast(room,{type:'presence',clients:presence(room)})}})
});
setInterval(()=>clients.forEach((_,w)=>w.readyState===WebSocket.OPEN&&w.ping()),25000);server.listen(PORT,'0.0.0.0',()=>console.log('Kollektiv Poster v4.1 running on '+PORT));
