const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;
const PUBLIC = path.join(__dirname, "public");

const state = {
  bg: { mode: "gradient", colorA: "#0a0a0a", colorB: "#3a2a55", angle: 135 },
  texture: { type: "noise", opacity: 0.16, color: "#ffffff", scale: 18 },
  brush: { size: 8, opacity: 0.8, type: "soft" },
  text: { value: "COLLECTIVE SIGNAL", x: 50, y: 16 },
  type: { font: "Arial", weight: 700, size: 42, letterSpacing: 2 },
  strokes: []
};

const clients = new Map();
let nextClientId = 1;

const roles = [
  { id: 1, name: "BACKGROUND" },
  { id: 2, name: "TEXTURE" },
  { id: 3, name: "GRAPHICS" },
  { id: 4, name: "BRUSH" },
  { id: 5, name: "TEXT" },
  { id: 6, name: "TYPE" }
];

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(payload) {
  for (const ws of clients.keys()) send(ws, payload);
}

function snapshot() {
  return { state, roles };
}

function roleTaken(roleId, exceptWs = null) {
  for (const [ws, info] of clients) {
    if (ws !== exceptWs && info.role === roleId) return true;
  }
  return false;
}

function assignRole(ws, requestedRole) {
  if (requestedRole && roles.some(r => r.id === requestedRole) && !roleTaken(requestedRole, ws)) {
    return requestedRole;
  }
  for (const r of roles) if (!roleTaken(r.id, ws)) return r.id;
  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, clients: clients.size }));
  }

  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC, file));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403); return res.end("Forbidden");
  }

  const ext = path.extname(filePath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server, path: "/ws" });

wss.on("connection", ws => {
  const info = { id: nextClientId++, role: null, room: null };
  clients.set(ws, info);

  send(ws, { type: "hello", clientId: info.id, roles, state: snapshot().state });

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "join") {
      info.room = String(msg.room || "main").slice(0, 40);
      info.role = assignRole(ws, Number(msg.requestedRole) || null);
      send(ws, { type: "joined", room: info.room, role: info.role, state: snapshot().state });
      broadcast({ type: "presence", clients: [...clients.values()].map(x => ({ id: x.id, role: x.role, room: x.room })) });
      return;
    }

    if (msg.type === "chat") {
      const text = String(msg.text || "").trim().slice(0, 240);
      if (text) broadcast({ type: "chat", from: info.role, text, ts: Date.now() });
      return;
    }

    if (msg.type === "stroke" && info.role === 3 && Array.isArray(msg.points)) {
      const points = msg.points.slice(0, 800).map(p => ({
        x: Number(p.x), y: Number(p.y)
      })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (points.length > 1) {
        const stroke = { points, ts: Date.now() };
        state.strokes.push(stroke);
        if (state.strokes.length > 3000) state.strokes.shift();
        broadcast({ type: "stroke", stroke });
      }
      return;
    }

    if (msg.type === "setState") {
      const allowed = {
        1: ["bg"],
        2: ["texture"],
        4: ["brush"],
        5: ["text"],
        6: ["type"]
      };
      const keys = allowed[info.role] || [];
      const key = String(msg.key || "");
      if (!keys.includes(key) || !msg.value || typeof msg.value !== "object") return;
      state[key] = { ...state[key], ...msg.value };
      broadcast({ type: "state", key, value: state[key] });
      return;
    }

    if (msg.type === "clear" && info.role === 3) {
      state.strokes = [];
      broadcast({ type: "clear" });
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    broadcast({ type: "presence", clients: [...clients.values()].map(x => ({ id: x.id, role: x.role, room: x.room })) });
  });
});

setInterval(() => {
  for (const ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }
}, 25000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Kollektiv Poster v3.3 running on ${PORT}`);
});
