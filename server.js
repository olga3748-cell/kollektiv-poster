// KOLLEKTIV / POSTER — kollektiv (multiplayer) server
//
// Separat sidoprojekt. Rör INTE och beror INTE på den inlämnade
// solofilen (kollektiv_poster_v2_3.html), som förblir helt
// server-oberoende. Den här servern hör bara ihop med klienten i
// public/index.html i den här mappen.
//
// Rollsystem: när ett rum skapas/går man med i får varje deltagare
// nästa roll i GUIDED_ORDER (person 1 = bakgrund, person 2 = textur, …).
// Vem som helst kan begära "ROTERA ROLLER" — då flyttas ALLA deltagare
// ett steg framåt i rollordningen samtidigt, direkt utan omröstning
// (enligt den enklare modell som beskrevs för solo-varianten). Format-
// byte (pappersstorlek/orientering) kräver däremot att alla röstar ja,
// eftersom det skalar om hela postern åt alla.

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 20000,
});

// Same order as GUIDED_ORDER in the client.
const GUIDED_ORDER = ['background', 'texture', 'copy', 'font', 'stickers', 'draw', 'paint', 'photo', 'chaos'];

/** @type {Map<string, Room>} */
const rooms = new Map();

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  let code;
  do {
    code = '';
    for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  } while (rooms.has(code));
  return code;
}

function safeName(name) {
  return (typeof name === 'string' ? name : '').trim().slice(0, 24) || 'ANONYM';
}

class Room {
  constructor(code) {
    this.code = code;
    /** @type {Map<string,{id:string,name:string,role:string}>} */
    this.participants = new Map();
    this.state = null; // opaque poster state blob, filled in by the first state-update
    this.formatVote = null; // {by, byName, size, orientation, voters:Set}
    this.createdAt = Date.now();
  }
  list() {
    return [...this.participants.values()];
  }
  nextRole() {
    return GUIDED_ORDER[this.participants.size % GUIDED_ORDER.length];
  }
}

function getOrNull(code) {
  return rooms.get((code || '').toUpperCase()) || null;
}

function broadcastPresence(room) {
  io.to(room.code).emit('presence', room.list());
}

function applyFieldOp(target, fields) {
  if (target && fields && typeof fields === 'object') Object.assign(target, fields);
}

io.on('connection', (socket) => {
  socket.data.room = null;

  socket.on('create-room', (payload, cb) => {
    try {
      const code = makeRoomCode();
      const room = new Room(code);
      const name = safeName(payload && payload.name);
      const role = room.nextRole();
      room.participants.set(socket.id, { id: socket.id, name, role });
      rooms.set(code, room);
      socket.join(code);
      socket.data.room = code;
      cb && cb({ ok: true, room: code, state: room.state, participants: room.list(), role });
    } catch (e) {
      cb && cb({ ok: false, error: 'Kunde inte skapa rum.' });
    }
  });

  socket.on('join-room', (payload, cb) => {
    const code = (payload && payload.room || '').toUpperCase();
    const room = getOrNull(code);
    if (!room) {
      cb && cb({ ok: false, error: 'Rummet finns inte eller har stängts.' });
      return;
    }
    const name = safeName(payload && payload.name);
    const existing = room.participants.get(socket.id);
    const role = existing ? existing.role : room.nextRole();
    room.participants.set(socket.id, { id: socket.id, name, role });
    socket.join(code);
    socket.data.room = code;
    cb && cb({ ok: true, room: code, state: room.state, participants: room.list(), role });
    broadcastPresence(room);
  });

  socket.on('leave-room', () => {
    leaveCurrentRoom(socket);
  });

  socket.on('disconnect', () => {
    leaveCurrentRoom(socket);
  });

  socket.on('state-update', (payload) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) return;
    if (payload.state && typeof payload.state === 'object') {
      room.state = payload.state;
      socket.to(room.code).emit('room-state', { room: room.code, state: room.state });
    }
  });

  socket.on('tool-op', (payload) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) return;
    const { bucket, fields } = payload;
    if (!bucket || !fields) return;
    if (room.state && room.state[bucket] && !Array.isArray(room.state[bucket])) {
      applyFieldOp(room.state[bucket], fields);
    }
    socket.to(room.code).emit('state-op', { room: room.code, type: 'tool', bucket, fields });
  });

  socket.on('object-op', (payload) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) return;
    const { bucket, index, fields } = payload;
    if (!bucket || index == null || !fields) return;
    if (room.state && Array.isArray(room.state[bucket]) && room.state[bucket][index]) {
      applyFieldOp(room.state[bucket][index], fields);
    }
    socket.to(room.code).emit('state-op', { room: room.code, type: 'object', bucket, index, fields });
  });

  socket.on('text-op', (payload) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) return;
    const { index, fields } = payload;
    if (index == null || !fields) return;
    if (room.state && Array.isArray(room.state.texts) && room.state.texts[index]) {
      applyFieldOp(room.state.texts[index], fields);
    }
    socket.to(room.code).emit('state-op', { room: room.code, type: 'text', index, fields });
  });

  socket.on('stroke-add', (payload) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) return;
    const { stroke } = payload;
    if (!stroke) return;
    if (room.state) {
      if (!Array.isArray(room.state.strokes)) room.state.strokes = [];
      room.state.strokes.push(stroke);
    }
    socket.to(room.code).emit('state-op', { room: room.code, type: 'stroke-add', stroke });
  });

  socket.on('strokes-replace', (payload) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) return;
    const { strokes } = payload;
    if (!Array.isArray(strokes)) return;
    if (room.state) room.state.strokes = strokes;
    socket.to(room.code).emit('state-op', { room: room.code, type: 'strokes-replace', strokes });
  });

  socket.on('quick-chat', (payload) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) return;
    const p = room.participants.get(socket.id);
    io.to(room.code).emit('quick-chat', {
      id: socket.id,
      name: (p && p.name) || 'ANONYM',
      phrase: String((payload && payload.phrase) || '').slice(0, 60),
      at: Date.now(),
    });
  });

  socket.on('activity', (payload) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) return;
    socket.to(room.code).emit('activity', { id: socket.id });
  });

  // Immediate round-robin rotation: everyone currently in the room moves
  // one step forward together, cycling through GUIDED_ORDER, per the
  // fairness rule ("alla ska ha haft alla roller"). No vote — anyone can
  // trigger it.
  socket.on('rotate-roles', (payload, cb) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) {
      cb && cb({ ok: false, error: 'Du är inte i det rummet.' });
      return;
    }
    for (const p of room.participants.values()) {
      const idx = GUIDED_ORDER.indexOf(p.role);
      p.role = GUIDED_ORDER[(idx + 1 + GUIDED_ORDER.length) % GUIDED_ORDER.length];
    }
    io.to(room.code).emit('role-change-complete', { participants: room.list() });
    cb && cb({ ok: true });
  });

  // Format change: needs unanimous yes because it rescales the whole
  // poster for everyone. The requester auto-counts as a yes vote. Only
  // the requester's own client actually performs the rescale (it alone
  // has the paper-size math) once everyone has agreed — see
  // 'format-apply-mine' below and its handler in the client.
  socket.on('request-format', (payload, cb) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) {
      cb && cb({ ok: false, error: 'Du är inte i det rummet.' });
      return;
    }
    const { size, orientation } = payload || {};
    if (!size || !orientation) {
      cb && cb({ ok: false, error: 'Ogiltigt format.' });
      return;
    }
    const requester = room.participants.get(socket.id);
    room.formatVote = {
      by: socket.id,
      byName: (requester && requester.name) || 'NÅGON',
      size,
      orientation,
      voters: new Set([socket.id]),
    };
    cb && cb({ ok: true });
    broadcastFormatVote(room);
    resolveFormatVoteIfReady(room);
  });

  socket.on('format-vote', (payload) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code || !room.formatVote) return;
    if (payload && payload.yes === false) {
      const p = room.participants.get(socket.id);
      io.to(room.code).emit('format-vote-cancelled', { byName: (p && p.name) || 'NÅGON' });
      room.formatVote = null;
      return;
    }
    room.formatVote.voters.add(socket.id);
    broadcastFormatVote(room);
    resolveFormatVoteIfReady(room);
  });

  socket.on('reset-room', (payload) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) return;
    // The actual visual reset reaches everyone through the normal
    // state-update -> room-state path a moment later; this just makes
    // sure a brand-new joiner right after a reset doesn't see stale
    // pre-reset content.
    room.state = null;
  });
});

function broadcastFormatVote(room) {
  if (!room.formatVote) return;
  const v = room.formatVote;
  io.to(room.code).emit('format-vote-request', {
    by: v.by,
    byName: v.byName,
    size: v.size,
    orientation: v.orientation,
    yes: v.voters.size,
    total: room.participants.size,
    voters: [...v.voters],
  });
}

function resolveFormatVoteIfReady(room) {
  const v = room.formatVote;
  if (!v) return;
  if (v.voters.size < room.participants.size) return;
  room.formatVote = null;
  io.to(room.code).emit('format-change-complete', {}); // clears every overlay
  io.to(v.by).emit('format-apply-mine', { size: v.size, orientation: v.orientation });
}

function leaveCurrentRoom(socket) {
  const code = socket.data.room;
  if (!code) return;
  const room = rooms.get(code);
  socket.data.room = null;
  socket.leave(code);
  if (!room) return;
  room.participants.delete(socket.id);
  if (room.formatVote) {
    room.formatVote.voters.delete(socket.id);
    if (room.formatVote.by === socket.id) room.formatVote = null;
  }
  if (room.participants.size === 0) {
    rooms.delete(code);
    return;
  }
  broadcastPresence(room);
  if (room.formatVote) resolveFormatVoteIfReady(room);
}

server.listen(PORT, () => {
  console.log(`KOLLEKTIV/POSTER-server körs på port ${PORT}`);
});
