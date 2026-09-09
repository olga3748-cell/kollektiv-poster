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

function cleanRoom(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}
function cleanName(v) {
  return String(v || 'ANONYM').replace(/[<>]/g, '').trim().slice(0, 24) || 'ANONYM';
}
function roomCode() {
  for (let tries = 0; tries < 100; tries++) {
    let code = '';
    for (let i = 0; i < 5; i++) code += codeChars[Math.floor(Math.random() * codeChars.length)];
    if (!rooms.has(code)) return code;
  }
  return Date.now().toString(36).toUpperCase().slice(-6);
}
function safeState(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  try {
    const json = JSON.stringify(v);
    if (json.length > 10_000_000) return null;
    return JSON.parse(json);
  } catch {
    return null;
  }
}
function participantList(code) {
  const r = rooms.get(code);
  if (!r) return [];
  return [...r.participants.entries()].map(([id, p]) => ({
    id, name: p.name, role: p.role
  }));
}
function touch(code) {
  const r = rooms.get(code);
  if (r) r.updatedAt = Date.now();
}
function broadcastPresence(code) {
  io.to(code).emit('presence', participantList(code));
}
function detach(socket) {
  const code = socket.data.room;
  if (!code) return;
  const r = rooms.get(code);
  socket.leave(code);
  socket.data.room = null;
  if (r) {
    r.participants.delete(socket.id);
    touch(code);
    broadcastPresence(code);
  }
}

app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('/api/room/:code', (req, res) => {
  const code = cleanRoom(req.params.code);
  const r = rooms.get(code);
  res.json({ ok: !!r, room: code, participants: r ? r.participants.size : 0 });
});

// Friendly shared links: /r/ABCDE -> /?room=ABCDE
app.get('/r/:code', (req, res) => {
  const code = cleanRoom(req.params.code);
  res.redirect('/?room=' + encodeURIComponent(code));
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', socket => {
  socket.on('create-room', ({ name, state } = {}, ack = () => {}) => {
    try {
      detach(socket);
      const code = roomCode();
      rooms.set(code, {
        state: safeState(state),
        participants: new Map(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      const r = rooms.get(code);
      r.participants.set(socket.id, { name: cleanName(name), role: 'paint' });
      socket.join(code);
      socket.data.room = code;
      ack({ ok: true, room: code, state: r.state, participants: participantList(code) });
      broadcastPresence(code);
    } catch (e) {
      console.error('create-room failed', e);
      ack({ ok: false, error: 'Kunde inte skapa rummet.' });
    }
  });

  socket.on('join-room', ({ room, name } = {}, ack = () => {}) => {
    try {
      const code = cleanRoom(room);
      const r = rooms.get(code);
      if (!r) return ack({ ok: false, error: 'Rummet finns inte längre.' });

      detach(socket);
      r.participants.set(socket.id, { name: cleanName(name), role: 'paint' });
      socket.join(code);
      socket.data.room = code;
      touch(code);

      ack({ ok: true, room: code, state: r.state, participants: participantList(code) });
      broadcastPresence(code);
    } catch (e) {
      console.error('join-room failed', e);
      ack({ ok: false, error: 'Kunde inte gå med i rummet.' });
    }
  });

  socket.on('state-update', ({ room, state } = {}) => {
    const code = cleanRoom(room);
    if (socket.data.room !== code) return;
    const r = rooms.get(code);
    if (!r) return;

    const next = safeState(state);
    if (!next) return;
    r.state = next;
    touch(code);
    socket.to(code).emit('room-state', { room: code, state: next, by: socket.id });
  });

  socket.on('presence-role', ({ room, role } = {}) => {
    const code = cleanRoom(room);
    if (socket.data.room !== code) return;
    const p = rooms.get(code)?.participants.get(socket.id);
    if (!p) return;
    p.role = String(role || '—').slice(0, 20);
    touch(code);
    broadcastPresence(code);
  });

  socket.on('leave-room', () => detach(socket));
  socket.on('disconnect', () => detach(socket));
});

setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (r.participants.size === 0 && now - r.updatedAt > ROOM_TTL_MS) {
      rooms.delete(code);
    }
  }
}, 60_000).unref();

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => {
  console.log(`KOLLEKTIV / POSTER V2 listening on ${port}`);
});
