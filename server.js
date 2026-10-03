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
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;

// K/P KOLLEKTIV: reconnect grace period. How long a participant's seat
// (their role, and their room+poster if they were the only one in it) is
// held open after their socket disconnects, before it's actually freed.
// Covers the ordinary cases: a brief WiFi blip, a phone locking its screen,
// an accidental tab reload. socket.io always hands a reconnecting client a
// brand-new socket.id, so without this the server had no way to recognise
// "this is the same person coming back" — every reconnect looked exactly
// like a stranger joining, got a fresh role via nextRole(), and (if they'd
// been alone) their room and poster were deleted the instant they
// disconnected, even for a one-second blip. See getClientToken() in the
// client and the `prior`/reconnect branch in join-room below.
const RECONNECT_GRACE_MS = Number(process.env.KOLLEKTIV_RECONNECT_GRACE_MS) || 45000;

// How many recent chat messages a room remembers for anyone joining or
// reconnecting -- matches the client's own DOM trim (see addChat), so
// history replay never shows more than a joiner would see live anyway.
const CHAT_HISTORY_MAX = 30;

// How many shared takes a room keeps at once (oldest dropped first) --
// matches the solo/local takes gallery's own MAX_TAKES in the client.
const MAX_TAKES = 12;

// K/P KOLLEKTIV: PERSISTENCE. Rooms used to live only in memory -- a server
// restart (a deploy, a crash, Render's free tier spinning down) silently
// wiped every room, every poster, every chat and take, with no warning to
// whoever was mid-session. Every room is now periodically written to a
// single JSON file and reloaded on boot, deliberately reusing the SAME
// reconnect-grace machinery as an ordinary disconnect (see
// RECONNECT_GRACE_MS above and loadRoomsFromDisk below) rather than
// building a second, parallel "is this session still valid" mechanism: a
// restart is treated as "everyone in every room disconnected at once".
const PERSIST_PATH = process.env.KOLLEKTIV_PERSIST_PATH || path.join(__dirname, 'data', 'rooms.json');
const PERSIST_DEBOUNCE_MS = 2000;
let persistTimer = null;

// K/P KOLLEKTIV: ROOM CLEANUP. Nothing ever used to delete a room except a
// participant actually leaving (see finalizeLeave's "room.participants.size
// === 0" branch) -- that correctly reaps a room the instant everyone's
// socket is gone, but says nothing about a room nobody has TOUCHED in days:
// a laptop put to sleep (not closed -- its socket can sit technically
// "connected" for a long time), an idle tab left open on a finished poster,
// or a server restart that restored a long-dead session's participants as
// connected:false with a fresh reconnect-grace timer that nobody was ever
// going to answer. None of those free the room, so both server memory and
// PERSIST_PATH just grow forever across a long-running deployment. A room
// is now stamped with `lastActivity` on every real edit (see touchRoom
// below) and a periodic sweep deletes any room that's gone cold for
// ROOM_IDLE_MS -- same outcome as everyone leaving, just not waiting for a
// disconnect event that may never come. A still-connected client in a swept
// room isn't forcibly kicked; its next action simply finds the room gone
// (the same "Rummet finns inte" every other missing-room path already
// returns), which is a graceful enough landing for a room nobody has
// touched in two full days.
const ROOM_IDLE_MS = Number(process.env.KOLLEKTIV_ROOM_IDLE_MS) || 48 * 60 * 60 * 1000; // 48h
const ROOM_SWEEP_INTERVAL_MS = Number(process.env.KOLLEKTIV_ROOM_SWEEP_INTERVAL_MS) || 60 * 60 * 1000; // 1h

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 20000,
  // K/P KOLLEKTIV: state-update sends the WHOLE poster (not a diff) on
  // every edit, including any photo data URLs already in it (see
  // scheduleRoomSync in the client). socket.io's default cap here is 1MB,
  // which a poster with just a couple of photos can realistically exceed --
  // past that cap the message is silently rejected and the sender gets
  // disconnected, which looks to a user like "sync just stopped working"
  // with no error message anywhere. Raised generously; the real fix
  // (sending diffs instead of the full state) is a bigger project for if
  // this ever becomes a real bottleneck.
  maxHttpBufferSize: 12 * 1024 * 1024,
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

// A per-browser-tab identity the CLIENT generates and persists in
// sessionStorage (see getClientToken() in public/index.html), sent on every
// create-room/join-room so a reconnecting socket -- which always gets a
// brand-new socket.id -- can be recognised as "the same participant coming
// back" rather than a stranger. Validated defensively since it crosses the
// network from a client we don't fully trust; anything that doesn't look
// like a token we generate is ignored in favour of a fresh server-made one,
// rather than trusted as-is.
function safeToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(token) ? token : null;
}
function makeToken() {
  return 'srv-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

class Room {
  constructor(code) {
    this.code = code;
    /** @type {Map<string,{id:string,name:string,role:string,token:string,connected:boolean}>} */
    this.participants = new Map();
    // clientToken -> current socket.id, so a reconnecting client can find
    // its own (now-stale) seat by the token it kept, not by socket.id.
    this.tokenIndex = new Map();
    // socket.id -> Timeout, one pending grace-period removal per
    // disconnected-but-not-yet-finalised participant (see scheduleLeave).
    this.disconnectTimers = new Map();
    this.state = null; // opaque poster state blob, filled in by the first state-update
    this.formatVote = null; // {by, byName, size, orientation, voters:Set}
    this.roleVote = null; // {by, byName, voters:Set}
    this.finishVote = null; // {by, byName, voters:Set} -- "avsluta tidigare"
    this.resetVote = null; // {by, byName, voters:Set} -- "börja om"
    // K/P KOLLEKTIV: ROLLBYTE (SWAP) -- a two-party lateral trade, not a
    // room-wide vote: only the chosen target needs to approve (not everyone),
    // and on yes their two roles are exchanged directly. Deliberately kept
    // separate from roleVote (the group-wide rotation) rather than replacing
    // it -- see request-swap below. {by, byName, byRole, target, targetName,
    // targetRole}; no voters:Set since exactly one other person's answer
    // resolves it either way.
    this.swapVote = null;
    this.roundsCompleted = 0; // successful role rotations this room has done
    this.chatLog = []; // last CHAT_HISTORY_MAX quick-chat messages, replayed to new/reconnecting joiners
    // K/P KOLLEKTIV: TAKES, delat. {id, at, thumb, state, by, byName, auto}
    // per entry -- `state` (the full serialised poster at that moment) is
    // kept here but deliberately left OUT of list()/broadcasts (see
    // publicTakes()); it's only ever sent to whoever explicitly asks to
    // open that one take (see 'load-take'), so routine presence/gallery
    // updates don't ship every photo in every saved take to everyone.
    this.takes = [];
    this.createdAt = Date.now();
    // Bumped by touchRoom() on every real edit/vote/join/leave -- see the
    // ROOM_IDLE_MS comment above for why this exists and what reads it.
    this.lastActivity = Date.now();
  }
  // Public shape only -- NEVER include `token` here. This is broadcast to
  // every participant in the room (presence) and returned in join/create
  // acks, so leaking another participant's token would let anyone steal
  // their seat (see the reconnect branch in join-room, which trusts
  // whoever presents a given token to be its owner).
  list() {
    return [...this.participants.values()].map(({ id, name, role, connected }) => ({ id, name, role, connected }));
  }
  // Thumbnail + metadata only -- see the `takes` field comment above for
  // why the full `state` never goes out in a broadcast/list.
  publicTakes() {
    return this.takes.map(({ id, at, thumb, byName, auto }) => ({ id, at, thumb, byName, auto }));
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

// Debounced -- state-update fires on nearly every stroke/drag, and writing
// the whole file (including any photo data URLs in room.state) to disk on
// every single one would be wasteful and could visibly stutter under heavy
// editing. Anything within PERSIST_DEBOUNCE_MS of a previous call collapses
// into one write; schedulePersistNow (used on shutdown) bypasses that.
function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistRoomsNow, PERSIST_DEBOUNCE_MS);
}

// Marks a room as having just had real activity (an edit, a vote, a chat
// message, someone joining or leaving) and schedules the usual debounced
// save. Every call site that used to call schedulePersist() directly for
// something tied to one specific room now goes through this instead, so
// ROOM_IDLE_MS sweeps (see sweepIdleRooms below) measure actual use rather
// than wall-clock time since the room was created.
function touchRoom(room) {
  room.lastActivity = Date.now();
  schedulePersist();
}

// Runs every ROOM_SWEEP_INTERVAL_MS. Anything that's gone untouched for
// ROOM_IDLE_MS is deleted exactly like finalizeLeave deletes an empty room
// (see that function's own comment) -- this just covers the case where a
// room never actually empties out on its own because a stale connection
// never sends a 'disconnect'.
function sweepIdleRooms() {
  const cutoff = Date.now() - ROOM_IDLE_MS;
  let swept = 0;
  for (const [code, room] of rooms) {
    if (room.lastActivity < cutoff) {
      rooms.delete(code);
      swept += 1;
    }
  }
  if (swept) {
    console.log(`Städade bort ${swept} rum utan aktivitet på över ${Math.round(ROOM_IDLE_MS / 3600000)}h.`);
    schedulePersist();
  }
}

// In-flight votes (roleVote/formatVote/swapVote/…) are deliberately NOT
// persisted -- they're short-lived and it's harmless for one to simply be
// gone after a restart (whoever was waiting on it just sees nothing happen
// and can ask again), versus the real complexity of resurrecting a
// half-completed group approval tied to sockets that no longer exist.
function persistRoomsNow() {
  clearTimeout(persistTimer);
  persistTimer = null;
  try {
    const data = {
      savedAt: Date.now(),
      rooms: [...rooms.values()].map((room) => ({
        code: room.code,
        participants: [...room.participants.values()].map((p) => ({ id: p.id, name: p.name, role: p.role, token: p.token })),
        state: room.state,
        chatLog: room.chatLog,
        takes: room.takes,
        roundsCompleted: room.roundsCompleted,
        createdAt: room.createdAt,
        lastActivity: room.lastActivity,
      })),
    };
    fs.mkdirSync(path.dirname(PERSIST_PATH), { recursive: true });
    // Write to a temp file then rename -- a crash/kill mid-write must never
    // leave rooms.json half-written and unparsable, wiping every room on
    // the NEXT boot too. rename() is atomic on the same filesystem.
    const tmpPath = PERSIST_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data));
    fs.renameSync(tmpPath, PERSIST_PATH);
  } catch (e) {
    console.error('Kunde inte spara rooms.json:', e.message);
  }
}

// Run once at boot, before the server starts accepting connections. Every
// restored participant starts marked connected:false with a fresh
// RECONNECT_GRACE_MS timer -- exactly scheduleLeave()'s own disconnected
// state, just entered directly instead of via a socket 'disconnect' event.
// Anyone who reconnects with their remembered token within that window
// (see the 'prior' branch in join-room) reclaims their seat and role
// completely normally; anyone who doesn't is cleaned up by the ordinary
// finalizeLeave path, same as any other abandoned session.
function loadRoomsFromDisk() {
  let raw;
  try {
    raw = fs.readFileSync(PERSIST_PATH, 'utf8');
  } catch (e) {
    return; // no saved file yet -- perfectly normal on a first boot
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('rooms.json gick inte att läsa (ogiltig JSON) -- startar utan sparade rum.');
    return;
  }
  if (!data || !Array.isArray(data.rooms)) return;
  let restored = 0, skippedIdle = 0;
  const idleCutoff = Date.now() - ROOM_IDLE_MS;
  for (const saved of data.rooms) {
    if (!saved || typeof saved.code !== 'string' || !Array.isArray(saved.participants) || !saved.participants.length) continue;
    // A room that was already cold when it was last saved (e.g. the server
    // sat down for longer than ROOM_IDLE_MS, or crashed long before anyone
    // noticed) has no business coming back from the dead on boot just to
    // sit there until the next sweep -- skip it the same as the sweep
    // itself would, instead of briefly reviving it.
    const savedActivity = typeof saved.lastActivity === 'number' ? saved.lastActivity
      : (typeof saved.createdAt === 'number' ? saved.createdAt : Date.now());
    if (savedActivity < idleCutoff) { skippedIdle += 1; continue; }
    const room = new Room(saved.code);
    room.state = saved.state && typeof saved.state === 'object' ? saved.state : null;
    room.chatLog = Array.isArray(saved.chatLog) ? saved.chatLog : [];
    room.takes = Array.isArray(saved.takes) ? saved.takes : [];
    room.roundsCompleted = Number(saved.roundsCompleted) || 0;
    room.createdAt = typeof saved.createdAt === 'number' ? saved.createdAt : Date.now();
    room.lastActivity = savedActivity;
    for (const p of saved.participants) {
      if (!p || typeof p.id !== 'string' || !safeToken(p.token)) continue;
      const participant = { id: p.id, name: safeName(p.name), role: GUIDED_ORDER.includes(p.role) ? p.role : GUIDED_ORDER[0], token: p.token, connected: false };
      room.participants.set(p.id, participant);
      room.tokenIndex.set(p.token, p.id);
      room.disconnectTimers.set(p.id, setTimeout(() => finalizeLeave(room, p.id), RECONNECT_GRACE_MS));
    }
    if (room.participants.size > 0) {
      rooms.set(room.code, room);
      restored += 1;
    }
  }
  if (restored) console.log(`Återställde ${restored} rum från ${PERSIST_PATH}.`);
  if (skippedIdle) console.log(`Hoppade över ${skippedIdle} rum som redan var över ${Math.round(ROOM_IDLE_MS / 3600000)}h inaktiva.`);
}

io.on('connection', (socket) => {
  socket.data.room = null;

  socket.on('create-room', (payload, cb) => {
    try {
      const code = makeRoomCode();
      const room = new Room(code);
      const name = safeName(payload && payload.name);
      const token = safeToken(payload && payload.token) || makeToken();
      const role = room.nextRole();
      room.participants.set(socket.id, { id: socket.id, name, role, token, connected: true });
      room.tokenIndex.set(token, socket.id);
      rooms.set(code, room);
      touchRoom(room);
      socket.join(code);
      socket.data.room = code;
      socket.data.token = token;
      // `token` is only ever sent back here, in this socket's own ack --
      // never broadcast (see Room.list()) -- so the client can present the
      // SAME token again after a reconnect and reclaim this exact seat.
      cb && cb({ ok: true, room: code, state: room.state, participants: room.list(), role, finished: room.roundsCompleted >= GUIDED_ORDER.length, token, chat: room.chatLog, takes: room.publicTakes() });
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
    const token = safeToken(payload && payload.token) || makeToken();

    // K/P KOLLEKTIV: reconnect -- this exact token already holds a seat in
    // this room, under a now-stale socket.id from before a disconnect (see
    // scheduleLeave/RECONNECT_GRACE_MS). Reclaim that seat's role instead
    // of handing out a fresh one via nextRole(), cancel its pending
    // grace-period removal, and move any in-flight vote this person was
    // part of over to the new socket.id so a mid-vote reconnect doesn't
    // silently drop their vote (or, if they were the requester, orphan the
    // whole request).
    const priorSocketId = room.tokenIndex.get(token);
    const prior = priorSocketId && priorSocketId !== socket.id ? room.participants.get(priorSocketId) : null;

    let role;
    if (prior) {
      role = prior.role;
      room.participants.delete(priorSocketId);
      cancelDisconnectTimer(room, priorSocketId);
      migrateVoteReferences(room, priorSocketId, socket.id);
    } else {
      const existing = room.participants.get(socket.id);
      role = existing ? existing.role : room.nextRole();
    }
    room.participants.set(socket.id, { id: socket.id, name, role, token, connected: true });
    room.tokenIndex.set(token, socket.id);
    touchRoom(room);
    socket.join(code);
    socket.data.room = code;
    socket.data.token = token;
    // K/P KOLLEKTIV: "finished" wasn't sent here before, so a client that
    // joined/reconnected into an already-finished room (or a room mid-reset)
    // had no way to know that except by coincidence of stale local state —
    // the actual bug behind "det står att jag är klar även om jag går in i
    // ett nytt rum". Now the client derives showGuidedFinished from this on
    // every room entry instead of trusting whatever it happened to hold
    // locally before.
    cb && cb({ ok: true, room: code, state: room.state, participants: room.list(), role, finished: room.roundsCompleted >= GUIDED_ORDER.length, token, chat: room.chatLog, takes: room.publicTakes() });
    broadcastPresence(room);
  });

  socket.on('leave-room', () => {
    // An explicit, deliberate leave -- unlike a disconnect, there's no
    // reason to hold the seat open, so this finalises immediately.
    const code = socket.data.room;
    if (!code) return;
    socket.data.room = null;
    socket.leave(code);
    const room = rooms.get(code);
    if (room) finalizeLeave(room, socket.id);
  });

  socket.on('disconnect', () => {
    scheduleLeave(socket);
  });

  socket.on('state-update', (payload) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) return;
    if (payload.state && typeof payload.state === 'object') {
      room.state = payload.state;
      socket.to(room.code).emit('room-state', { room: room.code, state: room.state });
      touchRoom(room);
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
    touchRoom(room);
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
    touchRoom(room);
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
    touchRoom(room);
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
    touchRoom(room);
  });

  socket.on('strokes-replace', (payload) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) return;
    const { strokes } = payload;
    if (!Array.isArray(strokes)) return;
    if (room.state) room.state.strokes = strokes;
    socket.to(room.code).emit('state-op', { room: room.code, type: 'strokes-replace', strokes });
    touchRoom(room);
  });

  socket.on('quick-chat', (payload) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) return;
    const p = room.participants.get(socket.id);
    const msg = {
      id: socket.id,
      name: (p && p.name) || 'ANONYM',
      phrase: String((payload && payload.phrase) || '').slice(0, 60),
      at: Date.now(),
    };
    // K/P KOLLEKTIV: chat used to only ever be relayed live -- anyone
    // joining or reconnecting mid-session saw a blank feed no matter how
    // much had already been said, with no way to catch up. Kept server-side
    // now (capped, same 30-line window the client already trims its DOM
    // to) and handed to every join/create ack (see 'chat' in those
    // responses) so a new arrival's feed starts populated instead of empty.
    room.chatLog.push(msg);
    if (room.chatLog.length > CHAT_HISTORY_MAX) room.chatLog.shift();
    io.to(room.code).emit('quick-chat', msg);
    touchRoom(room);
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
    if (room.swapVote) {
      cb && cb({ ok: false, error: 'En rollbytesförfrågan (byte mellan två) pågår redan.' });
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
    if (room.swapVote) {
      cb && cb({ ok: false, error: 'En rollbytesförfrågan (byte mellan två) pågår redan.' });
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
    // K/P KOLLEKTIV: allowlisted rather than just checked for truthiness --
    // this is network input, and 'size' ends up embedded in jsPDF's page
    // constructor on the requester's own client once the vote resolves (see
    // jspdfFormatFor in the client), so garbage here shouldn't be able to
    // reach that unchecked. Keep in sync with FORMAT_DIMS/#paperSize in the
    // client when adding a new size.
    if (!size || !orientation || !['A4', 'A3', 'Kvadrat'].includes(size) || !['portrait', 'landscape'].includes(orientation)) {
      cb && cb({ ok: false, error: 'Ogiltigt format.' });
      return;
    }
    if (room.resetVote) {
      cb && cb({ ok: false, error: 'En förfrågan om att börja om pågår redan.' });
      return;
    }
    if (room.swapVote) {
      cb && cb({ ok: false, error: 'En rollbytesförfrågan (byte mellan två) pågår redan.' });
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
    if (room.swapVote) {
      cb && cb({ ok: false, error: 'En rollbytesförfrågan (byte mellan två) pågår redan.' });
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

  // K/P KOLLEKTIV: TAKES, delat. A room-shared version of the existing
  // solo/local takes gallery (see the client's TAKES comment) -- instead of
  // living only in one browser's localStorage, a take saved in a
  // multiplayer room is stored here and broadcast to everyone in it.
  // Saved either manually (someone clicks "Spara take") or automatically
  // (one per completed role rotation -- see the `by` field on
  // role-change-complete and the client's role-change-complete handler).
  socket.on('save-take', (payload, cb) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) {
      cb && cb({ ok: false, error: 'Du är inte i det rummet.' });
      return;
    }
    const thumb = typeof (payload && payload.thumb) === 'string' ? payload.thumb : null;
    const state = typeof (payload && payload.state) === 'string' ? payload.state : null;
    if (!thumb || !state) {
      cb && cb({ ok: false, error: 'Ogiltig take.' });
      return;
    }
    const p = room.participants.get(socket.id);
    const take = {
      id: 't' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
      at: Date.now(),
      thumb,
      state,
      by: socket.id,
      byName: (p && p.name) || 'NÅGON',
      auto: !!(payload && payload.auto),
    };
    room.takes.push(take);
    if (room.takes.length > MAX_TAKES) room.takes.shift();
    io.to(room.code).emit('takes-updated', room.publicTakes());
    touchRoom(room);
    cb && cb({ ok: true, id: take.id });
  });

  // Full state (including any photos) is only ever sent here, on request
  // for ONE specific take -- never in the broadcast list (see publicTakes).
  socket.on('load-take', (payload, cb) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) {
      cb && cb({ ok: false, error: 'Du är inte i det rummet.' });
      return;
    }
    const take = room.takes.find((t) => t.id === (payload && payload.id));
    if (!take) {
      cb && cb({ ok: false, error: 'Taken finns inte längre.' });
      return;
    }
    cb && cb({ ok: true, state: take.state, thumb: take.thumb, at: take.at, byName: take.byName });
  });

  socket.on('delete-take', (payload, cb) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) {
      cb && cb({ ok: false, error: 'Du är inte i det rummet.' });
      return;
    }
    const before = room.takes.length;
    room.takes = room.takes.filter((t) => t.id !== (payload && payload.id));
    if (room.takes.length !== before) {
      io.to(room.code).emit('takes-updated', room.publicTakes());
      touchRoom(room);
    }
    cb && cb({ ok: true });
  });

  // K/P KOLLEKTIV: ROLLBYTE (SWAP) -- a lateral trade between exactly two
  // people, alongside (not instead of) the room-wide rotation above. Only
  // the chosen target has to approve; a NO (from either side) just cancels,
  // same as every other vote here. On YES their two current roles are
  // exchanged directly -- this never touches roundsCompleted, since it's a
  // swap, not a step forward, and doesn't affect the "everyone gets every
  // role" completion guarantee either way.
  socket.on('request-swap', (payload, cb) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code) {
      cb && cb({ ok: false, error: 'Du är inte i det rummet.' });
      return;
    }
    const targetId = payload && payload.target;
    if (!targetId || targetId === socket.id) {
      cb && cb({ ok: false, error: 'Välj en annan deltagare att byta roll med.' });
      return;
    }
    const target = room.participants.get(targetId);
    if (!target) {
      cb && cb({ ok: false, error: 'Den deltagaren finns inte längre.' });
      return;
    }
    if (target.connected === false) {
      cb && cb({ ok: false, error: (target.name || 'Den deltagaren') + ' är inte ansluten just nu.' });
      return;
    }
    if (room.swapVote) {
      cb && cb({ ok: false, error: 'En rollbytesförfrågan (byte mellan två) pågår redan.' });
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
    if (room.formatVote) {
      cb && cb({ ok: false, error: 'En förfrågan om formatbyte pågår redan.' });
      return;
    }
    const requester = room.participants.get(socket.id);
    room.swapVote = {
      by: socket.id,
      byName: (requester && requester.name) || 'NÅGON',
      byRole: requester && requester.role,
      target: targetId,
      targetName: target.name || 'NÅGON',
      targetRole: target.role,
    };
    cb && cb({ ok: true });
    broadcastSwapVote(room);
  });

  socket.on('swap-vote', (payload) => {
    const room = getOrNull(payload && payload.room);
    if (!room || socket.data.room !== room.code || !room.swapVote) return;
    const v = room.swapVote;
    // Only the two people involved can answer -- an onlooker's stray event
    // (or a stale client from a previous swapVote) can't cancel or resolve
    // someone else's request.
    if (socket.id !== v.by && socket.id !== v.target) return;
    if (payload && payload.yes === false) {
      const p = room.participants.get(socket.id);
      const byName = (p && p.name) || 'NÅGON';
      room.swapVote = null;
      io.to(v.by).emit('swap-vote-cancelled', { byName });
      io.to(v.target).emit('swap-vote-cancelled', { byName });
      return;
    }
    // A YES only counts from the target -- the requester already implicitly
    // said yes by asking (same "auto-yes" convention as every other vote).
    if (socket.id !== v.target) return;
    room.swapVote = null;
    const pa = room.participants.get(v.by);
    const pb = room.participants.get(v.target);
    if (pa && pb) {
      const tmp = pa.role;
      pa.role = pb.role;
      pb.role = tmp;
    }
    io.to(room.code).emit('swap-complete', { participants: room.list(), a: v.by, b: v.target });
    touchRoom(room);
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
    // `by` identifies the original requester -- kept for parity with the
    // other vote-completion broadcasts (format-apply-mine/reset-complete
    // also carry it) even though the client doesn't currently act on it
    // here; an earlier version used it to auto-save a shared take after
    // every rotation, dropped on request (it filled the gallery with takes
    // nobody asked for). Saving a take is manual-only now.
    by: v.by,
  });
  touchRoom(room);
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
  touchRoom(room);
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
  touchRoom(room);
}

// Private to the two people involved, unlike the other broadcastX helpers
// (which notify the whole room) -- a swap only concerns its requester and
// target, so onlookers never see the request at all. 'swap-request' is what
// pops the target's approval overlay; 'swap-request-state' just lets the
// requester's own UI show a "väntar på svar från X…" status.
function broadcastSwapVote(room) {
  if (!room.swapVote) return;
  const v = room.swapVote;
  const payload = {
    by: v.by,
    byName: v.byName,
    byRole: v.byRole,
    target: v.target,
    targetName: v.targetName,
    targetRole: v.targetRole,
  };
  io.to(v.target).emit('swap-request', payload);
  io.to(v.by).emit('swap-request-state', payload);
}

function cancelDisconnectTimer(room, socketId) {
  const timer = room.disconnectTimers.get(socketId);
  if (timer) {
    clearTimeout(timer);
    room.disconnectTimers.delete(socketId);
  }
}

// Moves any in-flight vote's references from a reconnecting participant's
// old (stale) socket.id to their new one, so a mid-vote reconnect doesn't
// silently drop their vote or, if they were the requester, orphan the
// whole request (format-apply-mine in particular targets `v.by` directly
// via io.to(v.by), so that has to stay pointed at a socket.id that's
// actually still connected).
function migrateVoteReferences(room, oldId, newId) {
  for (const vote of [room.formatVote, room.roleVote, room.finishVote, room.resetVote]) {
    if (!vote) continue;
    if (vote.by === oldId) vote.by = newId;
    if (vote.voters.has(oldId)) {
      vote.voters.delete(oldId);
      vote.voters.add(newId);
    }
  }
  // swapVote has no voters:Set (see the Room constructor comment) -- just
  // the two direct id references to fix up.
  if (room.swapVote) {
    if (room.swapVote.by === oldId) room.swapVote.by = newId;
    if (room.swapVote.target === oldId) room.swapVote.target = newId;
  }
}

// K/P KOLLEKTIV: a socket disconnecting (WiFi blip, phone locking its
// screen, an accidental tab reload) does NOT immediately vacate the seat
// any more -- it's marked `connected:false` (broadcast so others see a
// "återansluter…" state instead of the person just vanishing) and given
// RECONNECT_GRACE_MS to come back with the same token via join-room's
// reconnect branch, which cancels this timer. Only if that window elapses
// without a reconnect does finalizeLeave actually run -- the exact same
// cleanup this used to do unconditionally and instantly.
function scheduleLeave(socket) {
  const code = socket.data.room;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  const p = room.participants.get(socket.id);
  if (!p) return;
  p.connected = false;
  broadcastPresence(room);
  cancelDisconnectTimer(room, socket.id);
  room.disconnectTimers.set(socket.id, setTimeout(() => finalizeLeave(room, socket.id), RECONNECT_GRACE_MS));
}

// The actual departure: frees the role, cancels/reassigns votes tied to
// this participant, deletes the room if it's now empty. Runs either
// immediately (an explicit 'leave-room') or after the reconnect grace
// period expires with no reconnect (scheduleLeave above).
function finalizeLeave(room, socketId) {
  cancelDisconnectTimer(room, socketId);
  const p = room.participants.get(socketId);
  if (!p) return; // already reconnected (re-keyed to a new socket.id) or already gone
  room.participants.delete(socketId);
  if (room.tokenIndex.get(p.token) === socketId) room.tokenIndex.delete(p.token);
  if (room.formatVote) {
    room.formatVote.voters.delete(socketId);
    if (room.formatVote.by === socketId) room.formatVote = null;
  }
  if (room.roleVote) {
    room.roleVote.voters.delete(socketId);
    if (room.roleVote.by === socketId) {
      room.roleVote = null;
      io.to(room.code).emit('role-request-cancelled', { byName: 'NÅGON (LÄMNADE RUMMET)' });
    }
  }
  if (room.finishVote) {
    room.finishVote.voters.delete(socketId);
    if (room.finishVote.by === socketId) {
      room.finishVote = null;
      io.to(room.code).emit('finish-vote-cancelled', { byName: 'NÅGON (LÄMNADE RUMMET)' });
    }
  }
  if (room.resetVote) {
    room.resetVote.voters.delete(socketId);
    if (room.resetVote.by === socketId) {
      room.resetVote = null;
      io.to(room.code).emit('reset-vote-cancelled', { byName: 'NÅGON (LÄMNADE RUMMET)' });
    }
  }
  if (room.swapVote && (room.swapVote.by === socketId || room.swapVote.target === socketId)) {
    // Either party leaving cancels it outright -- there's no "everyone
    // else" to fall back on with only two participants involved.
    const other = room.swapVote.by === socketId ? room.swapVote.target : room.swapVote.by;
    room.swapVote = null;
    io.to(other).emit('swap-vote-cancelled', { byName: 'NÅGON (LÄMNADE RUMMET)' });
  }
  if (room.participants.size === 0) {
    rooms.delete(room.code);
    schedulePersist(); // so an empty room doesn't linger forever in rooms.json
    return;
  }
  broadcastPresence(room);
  touchRoom(room);
  if (room.formatVote) resolveFormatVoteIfReady(room);
  if (room.roleVote) resolveRoleVoteIfReady(room);
  if (room.resetVote) resolveResetVoteIfReady(room);
  if (room.finishVote) resolveFinishVoteIfReady(room);
}

loadRoomsFromDisk();

// K/P KOLLEKTIV: periodic idle-room sweep -- see ROOM_IDLE_MS/sweepIdleRooms
// above. unref() so this interval alone never keeps the process alive (a
// test server killed via SIGKILL/SIGTERM, or a clean shutdown, shouldn't
// have to wait on it).
setInterval(sweepIdleRooms, ROOM_SWEEP_INTERVAL_MS).unref();

// A graceful shutdown (deploy, container restart, ctrl-C locally) gets one
// last SYNCHRONOUS save -- persistRoomsNow uses writeFileSync/renameSync
// specifically so this can run to completion before the process actually
// exits, unlike the normal debounced schedulePersist path.
function shutdown(signal) {
  console.log(`${signal} mottaget, sparar rum till ${PERSIST_PATH}…`);
  persistRoomsNow();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(PORT, () => {
  console.log(`KOLLEKTIV/POSTER-server körs på port ${PORT}`);
});
