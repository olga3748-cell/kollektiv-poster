// KOLLEKTIV / POSTER — kollektiv (multiplayer) server
//
// Separat sidoprojekt. Rör INTE och beror INTE på den inlämnade
// solofilen (kollektiv_poster_v2_3.html), som förblir helt
// server-oberoende. Den här servern hör bara ihop med klienten i
// public/index.html i den här mappen.
//
// Rollsystem: när ett rum skapas/går man med i får varje deltagare
// nästa roll i GUIDED_ORDER (person 1 = bakgrund, person 2 = textur, …).
// Vem som helst kan trycka "BEGÄR ROLLBYTE" — det skickar en notis till
// alla andra i rummet, och ALLA måste godkänna (samma unanima
// omröstningsmönster som formatbyte) innan ALLA deltagare flyttas ett
// steg framåt i rollordningen samtidigt. Ett NEJ avbryter begäran helt.
// Rummet räknar hur många lyckade rotationer som gjorts — man är inte
// "klar" (och får se export/rensa-skärmen) förrän alla har hunnit
// rotera igenom samtliga GUIDED_ORDER.length roller, inte bara när någon
// råkar stå på CHAOS. Alla i rummet hamnar på klar-skärmen automatiskt
// samma ögonblick det händer (broadcast, inget manuellt steg).
//
// "AVSLUTA TIDIGARE" är en egen, separat omröstning (samma unanima
// mönster) som låter gruppen hoppa till klar-skärmen innan de hunnit
// rotera igenom alla roller — se request-finish/finish-vote nedan.

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
    this.roleVote = null; // {by, byName, voters:Set}
    this.finishVote = null; // {by, byName, voters:Set} -- "avsluta tidigare"
    this.resetVote = null; // {by, byName, voters:Set} -- "börja om"
    this.roundsCompleted = 0; // successful role rotations this room has done
    this.createdAt = Date.now();
  }
  list() {
    return [...this.participants.values()];
  }
  // The first role in GUIDED_ORDER nobody currently holds — not just
  // "count of participants so far": that broke as soon as anyone left and
  // someone new joined (the count-based index could land back on a role
  // that was still occupied). If everyone's role is taken (more people
  // than roles), hand out the least-occupied one so it stays as fair as
  // possible instead of erroring.
  nextRole() {
    const taken = new Set([...this.participants.values()].map((p) => p.role));
    for (const r of GUIDED_ORDER) if (!taken.has(r)) return r;
    const counts = new Map(GUIDED_ORDER.map((r) => [r, 0]));
    for (const p of this.participants.values()) counts.set(p.role, (counts.get(p.role) || 0) + 1);
    let best = GUIDED_ORDER[0], bestCount = Infinity;
    for (const r of GUIDED_ORDER) { const c = counts.get(r); if (c < bestCount) { bestCount = c; best = r; } }
    return best;
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
      cb && cb({ ok: true, room: code, state: room.state, participants: room.list(), role, finished: room.roundsCompleted >= GUIDED_ORDER.length });
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
    // K/P KOLLEKTIV: "finished" wasn't sent here before, so a client that
    // joined/reconnected into an already-finished room (or a room mid-reset)
    // had no way to know that except by coincidence of stale local state —
    // the actual bug behind "det står att jag är klar även om jag går in i
    // ett nytt rum". Now the client derives showGuidedFinished from this on
    // every room entry instead of trusting whatever it happened to hold
    // locally before.
    cb && cb({ ok: true, room: code, state: room.state, participants: room.list(), role, finished: room.roundsCompleted >= GUIDED_ORDER.length });
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

  // Role rotation needs unanimous yes, just like a format change: it
  // moves EVERY participant, not just the requester, so everyone else
  // gets a notification (role-request) and must approve (role-request-vote)
  // before it happens. The requester auto-counts as a yes. A single NO
  // cancels the whole request.
  socket.on('request-role', (payload, cb) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) {
      cb && cb({ ok: false, error: 'Du är inte i det rummet.' });
      return;
    }
    if (room.roleVote) {
      cb && cb({ ok: false, error: 'En rollbytesbegäran pågår redan.' });
      return;
    }
    if (room.finishVote) {
      cb && cb({ ok: false, error: 'En förfrågan om att avsluta pågår redan.' });
      return;
    }
    if (room.resetVote) {
      cb && cb({ ok: false, error: 'En förfrågan om att börja om pågår redan.' });
      return;
    }
    const requester = room.participants.get(socket.id);
    room.roleVote = {
      by: socket.id,
      byName: (requester && requester.name) || 'NÅGON',
      voters: new Set([socket.id]),
    };
    cb && cb({ ok: true });
    broadcastRoleVote(room);
    resolveRoleVoteIfReady(room);
  });

  socket.on('role-request-vote', (payload) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code || !room.roleVote) return;
    if (payload && payload.yes === false) {
      const p = room.participants.get(socket.id);
      io.to(room.code).emit('role-request-cancelled', { byName: (p && p.name) || 'NÅGON' });
      room.roleVote = null;
      return;
    }
    room.roleVote.voters.add(socket.id);
    broadcastRoleVote(room);
    resolveRoleVoteIfReady(room);
  });

  // "AVSLUTA TIDIGARE": same unanimous-vote pattern as request-role, but
  // instead of rotating roles it just marks the room finished so everyone
  // jumps to the export/klar screen right away.
  socket.on('request-finish', (payload, cb) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) {
      cb && cb({ ok: false, error: 'Du är inte i det rummet.' });
      return;
    }
    if (room.roundsCompleted >= GUIDED_ORDER.length) {
      cb && cb({ ok: false, error: 'Ni är redan klara.' });
      return;
    }
    if (room.finishVote) {
      cb && cb({ ok: false, error: 'En förfrågan om att avsluta pågår redan.' });
      return;
    }
    if (room.roleVote) {
      cb && cb({ ok: false, error: 'En rollbytesbegäran pågår redan.' });
      return;
    }
    if (room.resetVote) {
      cb && cb({ ok: false, error: 'En förfrågan om att börja om pågår redan.' });
      return;
    }
    const requester = room.participants.get(socket.id);
    room.finishVote = {
      by: socket.id,
      byName: (requester && requester.name) || 'NÅGON',
      voters: new Set([socket.id]),
    };
    cb && cb({ ok: true });
    broadcastFinishVote(room);
    resolveFinishVoteIfReady(room);
  });

  socket.on('finish-vote', (payload) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code || !room.finishVote) return;
    if (payload && payload.yes === false) {
      const p = room.participants.get(socket.id);
      io.to(room.code).emit('finish-vote-cancelled', { byName: (p && p.name) || 'NÅGON' });
      room.finishVote = null;
      return;
    }
    room.finishVote.voters.add(socket.id);
    broadcastFinishVote(room);
    resolveFinishVoteIfReady(room);
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
    if (room.resetVote) {
      cb && cb({ ok: false, error: 'En förfrågan om att börja om pågår redan.' });
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

  // K/P KOLLEKTIV: "BÖRJA OM" used to be a unilateral, unconfirmed
  // 'reset-room' fire-and-forget — any single participant could wipe the
  // whole room for everyone else with no say, and it never touched anyone's
  // assigned role (so after a reset people kept whatever role they'd
  // rotated to, which read as "rollfördelningen blir konstigt"). Replaced
  // with the same unanimous-vote pattern as request-role/request-format/
  // request-finish: everyone must approve, and once they do, every
  // participant's role is reassigned back to the FIRST roles (same rule as
  // a brand-new room — current join order, starting again from
  // GUIDED_ORDER[0]) and roundsCompleted resets to 0, so the group has to
  // rotate through every role again before reaching "klar".
  socket.on('request-reset', (payload, cb) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) {
      cb && cb({ ok: false, error: 'Du är inte i det rummet.' });
      return;
    }
    if (room.resetVote) {
      cb && cb({ ok: false, error: 'En förfrågan om att börja om pågår redan.' });
      return;
    }
    if (room.roleVote) {
      cb && cb({ ok: false, error: 'En rollbytesbegäran pågår redan.' });
      return;
    }
    if (room.finishVote) {
      cb && cb({ ok: false, error: 'En förfrågan om att avsluta pågår redan.' });
      return;
    }
    if (room.formatVote) {
      cb && cb({ ok: false, error: 'En förfrågan om formatbyte pågår redan.' });
      return;
    }
    const requester = room.participants.get(socket.id);
    room.resetVote = {
      by: socket.id,
      byName: (requester && requester.name) || 'NÅGON',
      voters: new Set([socket.id]),
    };
    cb && cb({ ok: true });
    broadcastResetVote(room);
    resolveResetVoteIfReady(room);
  });

  socket.on('reset-vote', (payload) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code || !room.resetVote) return;
    if (payload && payload.yes === false) {
      const p = room.participants.get(socket.id);
      io.to(room.code).emit('reset-vote-cancelled', { byName: (p && p.name) || 'NÅGON' });
      room.resetVote = null;
      return;
    }
    room.resetVote.voters.add(socket.id);
    broadcastResetVote(room);
    resolveResetVoteIfReady(room);
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

function broadcastRoleVote(room) {
  if (!room.roleVote) return;
  const v = room.roleVote;
  io.to(room.code).emit('role-request', {
    by: v.by,
    byName: v.byName,
    yes: v.voters.size,
    total: room.participants.size,
    voters: [...v.voters],
  });
}

function resolveRoleVoteIfReady(room) {
  const v = room.roleVote;
  if (!v) return;
  if (v.voters.size < room.participants.size) return;
  room.roleVote = null;
  for (const p of room.participants.values()) {
    const idx = GUIDED_ORDER.indexOf(p.role);
    p.role = GUIDED_ORDER[(idx + 1 + GUIDED_ORDER.length) % GUIDED_ORDER.length];
  }
  room.roundsCompleted += 1;
  io.to(room.code).emit('role-change-complete', {
    participants: room.list(),
    finished: room.roundsCompleted >= GUIDED_ORDER.length,
  });
}

function broadcastFinishVote(room) {
  if (!room.finishVote) return;
  const v = room.finishVote;
  io.to(room.code).emit('finish-vote-request', {
    by: v.by,
    byName: v.byName,
    yes: v.voters.size,
    total: room.participants.size,
    voters: [...v.voters],
  });
}

function resolveFinishVoteIfReady(room) {
  const v = room.finishVote;
  if (!v) return;
  if (v.voters.size < room.participants.size) return;
  room.finishVote = null;
  // Marking the room as having completed every rotation is exactly what
  // "finished" means elsewhere (role-change-complete's `finished` flag) --
  // ending early just gets there without actually rotating anyone's role.
  room.roundsCompleted = GUIDED_ORDER.length;
  io.to(room.code).emit('finish-early-complete', {});
}

function broadcastResetVote(room) {
  if (!room.resetVote) return;
  const v = room.resetVote;
  io.to(room.code).emit('reset-vote-request', {
    by: v.by,
    byName: v.byName,
    yes: v.voters.size,
    total: room.participants.size,
    voters: [...v.voters],
  });
}

function resolveResetVoteIfReady(room) {
  const v = room.resetVote;
  if (!v) return;
  if (v.voters.size < room.participants.size) return;
  room.resetVote = null;
  room.state = null;
  room.roundsCompleted = 0;
  // Throw everyone back to the FIRST roles — same rule as a brand-new room
  // (Room.nextRole/create-room): current join order, starting again from
  // GUIDED_ORDER[0], not whatever roles people happened to have rotated to.
  let i = 0;
  for (const p of room.participants.values()) {
    p.role = GUIDED_ORDER[i % GUIDED_ORDER.length];
    i += 1;
  }
  // Only the requester's client actually rebuilds the blank poster (fresh
  // random background seed etc.) and pushes it out via the normal
  // state-update path — same "one canonical source" pattern as
  // format-apply-mine above, so every client doesn't independently
  // generate its own randomised blank state and race the others.
  io.to(room.code).emit('reset-complete', { participants: room.list(), resetBy: v.by });
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
  if (room.roleVote) {
    room.roleVote.voters.delete(socket.id);
    if (room.roleVote.by === socket.id) {
      room.roleVote = null;
      io.to(code).emit('role-request-cancelled', { byName: 'NÅGON (LÄMNADE RUMMET)' });
    }
  }
  if (room.finishVote) {
    room.finishVote.voters.delete(socket.id);
    if (room.finishVote.by === socket.id) {
      room.finishVote = null;
      io.to(code).emit('finish-vote-cancelled', { byName: 'NÅGON (LÄMNADE RUMMET)' });
    }
  }
  if (room.resetVote) {
    room.resetVote.voters.delete(socket.id);
    if (room.resetVote.by === socket.id) {
      room.resetVote = null;
      io.to(code).emit('reset-vote-cancelled', { byName: 'NÅGON (LÄMNADE RUMMET)' });
    }
  }
  if (room.participants.size === 0) {
    rooms.delete(code);
    return;
  }
  broadcastPresence(room);
  if (room.formatVote) resolveFormatVoteIfReady(room);
  if (room.roleVote) resolveRoleVoteIfReady(room);
  if (room.resetVote) resolveResetVoteIfReady(room);
  if (room.finishVote) resolveFinishVoteIfReady(room);
}

server.listen(PORT, () => {
  console.log(`KOLLEKTIV/POSTER-server körs på port ${PORT}`);
});
