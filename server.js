
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 10000;
const publicDir = path.join(__dirname, "public");
const rooms = new Map();

const blankState = () => ({
  bg: { mode: "gradient", color1: "#fff1c7", color2: "#b8d8ff", angle: 35 },
  texture: { type: "noise", opacity: 0.08, color: "#111111", scale: 42 },
  graphics: { color: "#ff4fa3" },
  brush: { size: 18, opacity: 0.85, tool: "round" },
  text: { value: "COLLECTIVE", x: 50, y: 50 },
  type: { font: "Arial", weight: "700", size: 52 }
});

const makeRoom = () => ({ clients: new Set(), state: blankState(), strokes: [], chat: [] });

function getRoom(code) {
  if (!rooms.has(code)) rooms.set(code, makeRoom());
  return rooms.get(code);
}

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}
function broadcast(room, data, except = null) {
  for (const c of room.clients) if (c !== except) send(c, data);
}
function presence(room) {
  return [...room.clients].map(c => c.role).filter(Boolean);
}

const server = http.createServer((req, res) => {
  let file = req.url.split("?")[0];
  if (file === "/health") {
    res.writeHead(200, {"Content-Type":"application/json"});
    return res.end(JSON.stringify({ok:true, rooms: rooms.size}));
  }
  if (file === "/" || file === "") file = "/index.html";
  const safe = path.normalize(file).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(publicDir, safe);
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(full);
    const types = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json"};
    res.writeHead(200, {"Content-Type": types[ext] || "application/octet-stream"});
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
wss.on("connection", ws => {
  ws.room = null; ws.role = null;
  send(ws, {type:"hello"});
  ws.on("message", raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "join") {
      const code = String(msg.room || "").trim().toUpperCase().slice(0, 12);
      if (!code) return send(ws,{type:"error",message:"Skriv ett rumsnamn."});
      const room = getRoom(code);
      if (room.clients.size >= 6) return send(ws,{type:"error",message:"Rummet är fullt (6 personer)."});
      ws.room = room; ws.roomCode = code;
      room.clients.add(ws);
      const used = new Set(presence(room));
      ws.role = [1,2,3,4,5,6].find(n => !used.has(n)) || null;
      send(ws,{type:"joined", room:code, role:ws.role, state:room.state, strokes:room.strokes, chat:room.chat});
      broadcast(room,{type:"presence", roles:presence(room)});
      return;
    }

    const room = ws.room;
    if (!room) return;

    if (msg.type === "setState" && msg.section && msg.patch) {
      if (!room.state[msg.section]) return;
      Object.assign(room.state[msg.section], msg.patch);
      broadcast(room,{type:"state", section:msg.section, patch:msg.patch});
    }

    if (msg.type === "stroke" && Array.isArray(msg.points)) {
      const stroke = {points:msg.points.slice(0,4000), color:msg.color, size:msg.size, opacity:msg.opacity, tool:msg.tool};
      room.strokes.push(stroke);
      if (room.strokes.length > 5000) room.strokes.shift();
      broadcast(room,{type:"stroke", stroke});
    }

    if (msg.type === "chat" && msg.text) {
      const item = {role:ws.role, text:String(msg.text).slice(0,300), t:Date.now()};
      room.chat.push(item);
      if (room.chat.length > 100) room.chat.shift();
      broadcast(room,{type:"chat", item});
    }
  });

  ws.on("close", () => {
    const room = ws.room;
    if (!room) return;
    room.clients.delete(ws);
    broadcast(room,{type:"presence", roles:presence(room)});
    if (!room.clients.size) rooms.delete(ws.roomCode);
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`Kollektiv Poster v3 running on ${PORT}`));
