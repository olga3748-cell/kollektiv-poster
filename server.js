const http=require('http'),fs=require('fs'),path=require('path');const WebSocket=require('ws');
const PORT=process.env.PORT||10000,PUBLIC=path.join(__dirname,'public');
const ROLES=[{id:1,name:'BAKGRUND'},{id:2,name:'TEXTUR'},{id:3,name:'STICKERS'},{id:4,name:'COPYWRITER'},{id:5,name:'TYPSNITT'},{id:6,name:'TECKNA'},{id:7,name:'PAINTBRUSH'},{id:8,name:'CHAOS'},{id:9,name:'FOTOGRAF'}];
const state={bg:{mode:'gradient',colorA:'#101010',colorB:'#5a416f',angle:135},texture:{type:'noise',opacity:.1,color:'#fff',scale:18},stickers:[],textLayers:[{id:1,value:'COLLECTIVE SIGNAL',x:50,y:15,color:'#fff',size:42,shadow:true}],type:{font:'Arial',weight:'700',height:100,width:100,skew:0},draw:{color:'#fff',strokes:[]},brush:{size:8,opacity:.8,type:'soft',jitter:0,spacing:1},chaos:{amount:0,mode:'jitter',frequency:5},photos:[]};
let nextClient=1,nextSticker=1,nextText=2;
const clients=new Map(); // ws -> client
const roomState=new Map(); // room -> shared poster state
const proposals=new Map(); // room -> proposal

function clone(o){return JSON.parse(JSON.stringify(o))}
function initialState(){return {bg:{mode:'gradient',colorA:'#101010',colorB:'#5a416f',angle:135},texture:{type:'noise',opacity:.1,color:'#fff',scale:18},stickers:[],textLayers:[{id:1,value:'COLLECTIVE SIGNAL',x:50,y:15,color:'#fff',size:42,shadow:true,font:'Arial',weight:'700',height:100,width:100,skew:0}],type:{font:'Arial',weight:'700',height:100,width:100,skew:0},draw:{color:'#fff',strokes:[]},brush:{size:8,opacity:.8,type:'soft',jitter:0,spacing:1},chaos:{amount:0,mode:'glitch',frequency:5},photos:[]}}
function getState(room){if(!roomState.has(room))roomState.set(room,initialState());return roomState.get(room)}
const send=(w,x)=>w.readyState===WebSocket.OPEN&&w.send(JSON.stringify(x));
const roomClients=room=>[...clients.entries()].filter(([,c])=>c.room===room);
const broadcast=(room,x)=>roomClients(room).forEach(([w])=>send(w,x));
const presence=room=>roomClients(room).map(([,c])=>({id:c.id,role:c.role,room:c.room}));
const taken=(r,e,room)=>roomClients(room).some(([w,c])=>w!==e&&c.role===r);
function assign(w,r,room){if(r&&ROLES.some(x=>x.id===r)&&!taken(r,w,room))return r;return ROLES.find(x=>!taken(x.id,w,room))?.id||null}
function prop(room){let p=proposals.get(room);return p?{requester:p.requester,requestedRole:p.requestedRole,approvals:[...p.approvals],total:roomClients(room).length}:null}
function resetProposal(room){if(proposals.has(room)){proposals.delete(room);broadcast(room,{type:'roleProposal',proposal:null})}}
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://'+req.headers.host);if(u.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,clients:clients.size}))}let f=u.pathname==='/'?'/index.html':u.pathname,p=path.normalize(path.join(PUBLIC,f));if(!p.startsWith(PUBLIC))return res.end('Forbidden');fs.readFile(p,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'Content-Type':p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css; charset=utf-8':'application/octet-stream'});res.end(d)})});
const wss=new WebSocket.Server({server,path:'/ws'});
wss.on('connection',ws=>{
  const c={id:nextClient++,role:null,room:null};
  clients.set(ws,c);
  send(ws,{type:'hello',clientId:c.id,roles:ROLES});
  ws.on('message',raw=>{
    let m; try{m=JSON.parse(raw)}catch{return}
    if(m.type==='join'){
      c.room=String(m.room||'MAIN').trim().slice(0,40)||'MAIN';
      const state=getState(c.room);
      c.role=assign(ws,Number(m.requestedRole)||null,c.room);
      send(ws,{type:'joined',role:c.role,state,proposal:prop(c.room),clients:presence(c.room)});
      broadcast(c.room,{type:'presence',clients:presence(c.room)});
      return;
    }
    if(!c.room)return;
    const room=c.room,state=getState(room);
    if(m.type==='chat'){let text=String(m.text||'').trim().slice(0,500);if(text)broadcast(room,{type:'chat',from:c.id,role:c.role,text});return}
    if(m.type==='roleRequest'){
      const r=Number(m.requestedRole);
      if(!c.role||!ROLES.some(x=>x.id===r)||r===c.role)return;
      if(proposals.has(room))return;
      proposals.set(room,{requester:c.id,requestedRole:r,approvals:new Set([c.id])});
      broadcast(room,{type:'roleProposal',proposal:prop(room)});return;
    }
    if(m.type==='roleApprove'){
      const p=proposals.get(room);if(!p)return;
      if(!roomClients(room).some(([,x])=>x.id===c.id))return;
      p.approvals.add(c.id);
      const members=roomClients(room).map(([,x])=>x);
      if(members.length && members.every(x=>p.approvals.has(x.id))){
        const a=members.find(x=>x.id===p.requester),b=members.find(x=>x.role===p.requestedRole);
        if(a){
          if(b){const old=a.role;a.role=b.role;b.role=old}
          else a.role=p.requestedRole;
          roomClients(room).forEach(([w,x])=>send(w,{type:'roleChanged',role:x.role,clients:presence(room)}));
        }
        resetProposal(room);
      }else broadcast(room,{type:'roleProposal',proposal:prop(room)});
      return;
    }
    if(m.type==='roleCancel'&&proposals.get(room)?.requester===c.id){resetProposal(room);return}
    const allowed={1:['bg'],2:['texture'],3:['stickers'],4:['textLayers'],5:['type'],6:['draw'],7:['brush'],8:['chaos'],9:['photos']};
    if(m.type==='set'){
      let k=String(m.key||'');if(!(allowed[c.role]||[]).includes(k))return;
      state[k]=Array.isArray(m.value)?m.value.slice(0,80):{...state[k],...m.value};
      broadcast(room,{type:'state',key:k,value:state[k]});return;
    }
    if(m.type==='addSticker'&&c.role===3){
      state.stickers.push({id:nextSticker++,shape:['star','heart','circle','square'].includes(m.shape)?m.shape:'star',x:50,y:50,size:90,color:'#fff'});
      broadcast(room,{type:'state',key:'stickers',value:state.stickers});return;
    }
    if(m.type==='removeSticker'&&c.role===3){state.stickers=state.stickers.filter(x=>x.id!==Number(m.id));broadcast(room,{type:'state',key:'stickers',value:state.stickers});return}
    if(m.type==='addText'&&c.role===4){
      state.textLayers.push({id:nextText++,value:'NEW TEXT',x:50,y:25,color:'#fff',size:42,shadow:true,font:'Arial',weight:'700',height:100,width:100,skew:0});
      broadcast(room,{type:'state',key:'textLayers',value:state.textLayers});return;
    }
    if(m.type==='removeText'&&c.role===4){state.textLayers=state.textLayers.filter(x=>x.id!==Number(m.id));broadcast(room,{type:'state',key:'textLayers',value:state.textLayers});return}
    if(m.type==='stroke'&&c.role===6&&Array.isArray(m.points)){
      let pts=m.points.slice(0,900).map(p=>({x:+p.x,y:+p.y})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
      if(pts.length>1){let s={points:pts};state.draw.strokes.push(s);if(state.draw.strokes.length>4000)state.draw.strokes.shift();broadcast(room,{type:'stroke',stroke:s})}return;
    }
    if(m.type==='clear'&&c.role===6){state.draw.strokes=[];broadcast(room,{type:'clear'});return}
  });
  ws.on('close',()=>{
    const room=c.room;clients.delete(ws);
    if(room){
      const p=proposals.get(room);if(p){p.approvals.delete(c.id);if(p.requester===c.id)resetProposal(room);else broadcast(room,{type:'roleProposal',proposal:prop(room)})}
      broadcast(room,{type:'presence',clients:presence(room)});
    }
  });
});
setInterval(()=>clients.forEach((_,w)=>w.readyState===WebSocket.OPEN&&w.ping()),25000);server.listen(PORT,'0.0.0.0',()=>console.log('Kollektiv Poster v3.5 running on '+PORT));
