const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;
const PUBLIC = path.join(__dirname, "public");

const ROLES = [
  {id:1,name:"BACKGROUND"},
  {id:2,name:"TEXTURE"},
  {id:3,name:"GRAPHICS"},
  {id:4,name:"BRUSH"},
  {id:5,name:"TEXT"},
  {id:6,name:"TYPE"},
  {id:7,name:"CHAOS"}
];

const state = {
  bg:{mode:"gradient",colorA:"#0a0a0a",colorB:"#3a2a55",angle:135},
  texture:{type:"noise",opacity:.12,color:"#ffffff",scale:18},
  brush:{size:8,opacity:.8,type:"soft"},
  textLayers:[
    {id:1,value:"COLLECTIVE SIGNAL",x:50,y:16,color:"#ffffff",visible:true}
  ],
  type:{font:"Arial",weight:"700",size:42,letterSpacing:2},
  strokes:[],
  chaos:{amount:0,mode:"jitter",frequency:5}
};

const clients = new Map();
let nextId = 1;
let nextTextId = 2;
let roleProposal = null;

function send(ws,p){ if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(p)); }
function broadcast(p){ for(const ws of clients.keys()) send(ws,p); }
function presence(){
  return [...clients.values()].map(c=>({id:c.id,role:c.role,room:c.room,name:`P${c.id}`}));
}
function allConnectedApproved(){
  if(clients.size===0 || !roleProposal) return false;
  return [...clients.keys()].every(ws=>roleProposal.approvals.has(clients.get(ws).id));
}
function roleTaken(role, except){
  for(const [ws,c] of clients) if(ws!==except && c.role===role) return true;
  return false;
}
function assignRole(ws,requested){
  if(requested && ROLES.some(r=>r.id===requested) && !roleTaken(requested,ws)) return requested;
  for(const r of ROLES) if(!roleTaken(r.id,ws)) return r.id;
  return null;
}
function resetProposal(){
  roleProposal=null;
  broadcast({type:"roleProposal",proposal:null});
}

const server=http.createServer((req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host}`);
  if(url.pathname==="/health"){
    res.writeHead(200,{"Content-Type":"application/json"});
    return res.end(JSON.stringify({ok:true,clients:clients.size}));
  }
  let file=url.pathname==="/" ? "/index.html" : url.pathname;
  const fp=path.normalize(path.join(PUBLIC,file));
  if(!fp.startsWith(PUBLIC)){res.writeHead(403);return res.end("Forbidden")}
  fs.readFile(fp,(err,data)=>{
    if(err){res.writeHead(404);return res.end("Not found")}
    const ext=path.extname(fp);
    const ct={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8"}[ext]||"application/octet-stream";
    res.writeHead(200,{"Content-Type":ct});res.end(data);
  });
});

const wss=new WebSocket.Server({server,path:"/ws"});

wss.on("connection",ws=>{
  const c={id:nextId++,role:null,room:null};
  clients.set(ws,c);
  send(ws,{type:"hello",state,roles:ROLES,proposal:null});

  ws.on("message",raw=>{
    let m; try{m=JSON.parse(raw.toString())}catch{return}

    if(m.type==="join"){
      c.room=String(m.room||"MAIN").slice(0,40);
      c.role=assignRole(ws,Number(m.requestedRole)||null);
      send(ws,{type:"joined",role:c.role,state,proposal:roleProposal?{
        requester:roleProposal.requester,
        requestedRole:roleProposal.requestedRole,
        approvals:[...roleProposal.approvals]
      }:null});
      broadcast({type:"presence",clients:presence()});
      return;
    }

    if(m.type==="chat"){
      const text=String(m.text||"").trim().slice(0,240);
      if(text) broadcast({type:"chat",from:c.role,text,ts:Date.now()});
      return;
    }

    if(m.type==="roleRequest"){
      const requested=Number(m.requestedRole);
      if(!c.role || !ROLES.some(r=>r.id===requested) || requested===c.role || roleTaken(requested,ws)) return;
      roleProposal={requester:c.id,requestedRole:requested,approvals:new Set([c.id])};
      broadcast({type:"roleProposal",proposal:{
        requester:c.id,requestedRole:requested,approvals:[...roleProposal.approvals],
        total:clients.size
      }});
      return;
    }

    if(m.type==="roleApprove"){
      if(!roleProposal) return;
      roleProposal.approvals.add(c.id);
      broadcast({type:"roleProposal",proposal:{
        requester:roleProposal.requester,requestedRole:roleProposal.requestedRole,
        approvals:[...roleProposal.approvals],total:clients.size
      }});
      if(allConnectedApproved()){
        const requester=[...clients.entries()].find(([,x])=>x.id===roleProposal.requester);
        if(requester){
          const [rws,rc]=requester;
          const target=[...clients.entries()].find(([,x])=>x.role===roleProposal.requestedRole);
          if(target){
            const [tws,tc]=target;
            const old=rc.role; rc.role=tc.role; tc.role=old;
            send(rws,{type:"roleChanged",role:rc.role});
            send(tws,{type:"roleChanged",role:tc.role});
          } else {
            rc.role=roleProposal.requestedRole;
            send(rws,{type:"roleChanged",role:rc.role});
          }
        }
        broadcast({type:"presence",clients:presence()});
        resetProposal();
      }
      return;
    }

    if(m.type==="roleCancel" && roleProposal && roleProposal.requester===c.id){
      resetProposal(); return;
    }

    if(m.type==="setState"){
      const allowed={1:["bg"],2:["texture"],4:["brush"],5:["textLayers"],6:["type"],7:["chaos"]};
      const key=String(m.key||"");
      if(!(allowed[c.role]||[]).includes(key) || !m.value || typeof m.value!=="object") return;
      if(key==="textLayers") state.textLayers=Array.isArray(m.value)?m.value.slice(0,30):state.textLayers;
      else state[key]={...state[key],...m.value};
      broadcast({type:"state",key,value:state[key]});
      return;
    }

    if(m.type==="textAdd" && c.role===5){
      const value=String(m.value||"NEW TEXT").slice(0,120);
      const layer={id:nextTextId++,value,x:50,y:25,color:"#ffffff",visible:true};
      state.textLayers.push(layer);
      broadcast({type:"state",key:"textLayers",value:state.textLayers});
      return;
    }

    if(m.type==="textRemove" && c.role===5){
      const id=Number(m.id);
      state.textLayers=state.textLayers.filter(x=>x.id!==id);
      broadcast({type:"state",key:"textLayers",value:state.textLayers});
      return;
    }

    if(m.type==="stroke" && c.role===3 && Array.isArray(m.points)){
      const points=m.points.slice(0,800).map(p=>({x:Number(p.x),y:Number(p.y)}))
        .filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
      if(points.length>1){
        const stroke={points,ts:Date.now()};
        state.strokes.push(stroke);
        if(state.strokes.length>3000) state.strokes.shift();
        broadcast({type:"stroke",stroke});
      }
      return;
    }

    if(m.type==="clear" && c.role===3){
      state.strokes=[];broadcast({type:"clear"});
    }
  });

  ws.on("close",()=>{
    clients.delete(ws);
    if(roleProposal){
      roleProposal.approvals.delete(c.id);
      if(roleProposal.requester===c.id) resetProposal();
    }
    broadcast({type:"presence",clients:presence()});
  });
});

setInterval(()=>{for(const ws of clients.keys())if(ws.readyState===WebSocket.OPEN)ws.ping()},25000);
server.listen(PORT,"0.0.0.0",()=>console.log(`Kollektiv Poster v3.4 running on ${PORT}`));
