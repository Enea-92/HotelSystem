#!/usr/bin/env node
// Load test for the hotel guest platform: simulates N rooms sending chat
// messages, quick requests, issue reports (with a photo), room-service orders
// and feedback, while guest + staff sockets listen live — then reports
// latency percentiles, error counts, rate-limit (429) hits and how fast
// messages reach staff over the socket.
//
// SAFETY: this writes lots of FAKE data. By default every fake room is named
// with a prefix ("LT-101", "LT-102", ...) so it can never land in a real
// guest's chat, and so cleanup.js can delete exactly those rows afterwards.
// The script refuses to touch a non-localhost URL unless you pass --allow-remote.
//
// Usage:
//   npm install socket.io-client
//   node loadtest.js --url http://localhost:3001 --super-password <SUPER_ADMIN_PASSWORD>
//
// Options (all optional):
//   --url              backend base URL                (default http://localhost:3001)
//   --hotels           comma-separated hotel slugs     (default loadtest)  e.g. bregu,seaview
//   --super-password   creates a hotel if it doesn't exist (SUPER_ADMIN_PASSWORD)
//   --room-from        first room number               (default 101)
//   --room-to          last room number                (default 600; 500 rooms)
//   --room-prefix      prefix added to every room name (default "LT-"; use "" for the real
//                      numbers — only do that when no real guests are in those rooms!)
//   --per-room         events per room during the run  (default 5 = a whole day's worth)
//                      (rooms and events apply to EACH hotel in --hotels)
//   --duration         seconds to spread them over     (default 60; shorter = harsher peak)
//   --passwords        ADMIN password per hotel, needed because chat is now protected by room keys:
//                      --passwords seaview=ADMINPW1,daylux=ADMINPW2   (one call fetches all room keys;
//                      the same password is used for the staff socket)
//   --allow-remote     allow a non-localhost --url

const { io } = require('socket.io-client');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const URL_BASE = String(arg('url', 'http://localhost:3001')).replace(/\/$/, '');
const HOTELS = String(arg('hotels', arg('hotel', 'loadtest'))).toLowerCase().split(',').map((h) => h.trim()).filter(Boolean);
const SUPER_PW = arg('super-password', '');
const ROOM_FROM = Number(arg('room-from', 101));
const ROOM_TO = Number(arg('room-to', 600));
const ROOM_PREFIX = arg('room-prefix', 'LT-') === true ? '' : String(arg('room-prefix', 'LT-'));
const ROOMS = ROOM_TO - ROOM_FROM + 1;
const PER_ROOM = Number(arg('per-room', 5));
const DURATION = Number(arg('duration', 60));
const PASSWORDS = {};
String(arg('passwords', '')).split(',').forEach((p) => { const i = p.indexOf('='); if (i > 0) PASSWORDS[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1); });
const KEYS = {}; // hotel -> { room: key }
const ALLOW_REMOTE = arg('allow-remote', false) === true;

const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(URL_BASE);
if (!isLocal && !ALLOW_REMOTE) {
  console.error(
    `Refusing to run against ${URL_BASE}: it is not localhost.\n` +
    `This test creates thousands of fake messages/orders and sends fake push alerts.\n` +
    `Point it at a local server / test database, or add --allow-remote if you really mean it.`
  );
  process.exit(1);
}

// ~25 KB fake "photo" so issue reports carry realistic payload weight.
const FAKE_IMAGE = 'data:image/jpeg;base64,' + Buffer.alloc(25 * 1024, 7).toString('base64');
const SAMPLE_TEXTS = [
  'Hello, what time is breakfast?', 'Could we get extra towels please?',
  'The wifi is not working in my room', 'Can I have a late checkout?',
  'Is there a pharmacy nearby?', 'Where can I park?'
];
const REQUEST_TYPES = ['Extra towels', 'Room cleaning', 'Extra pillows', 'Shampoo', 'Slippers'];
const ISSUE_TYPES = ['AC not working', 'TV not working', 'Plumbing problem', 'Electrical problem'];

// ---------- stats ----------
const stats = {};
function rec(name, ms, status) {
  const s = (stats[name] ||= { lat: [], ok: 0, rateLimited: 0, otherErr: 0, netErr: 0, firstErr: '' });
  s.lat.push(ms);
  if (status >= 200 && status < 300) s.ok++;
  else if (status === 429) s.rateLimited++;
  else if (status === 0) s.netErr++;
  else s.otherErr++;
}
function pct(arr, p) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
}

async function call(name, path, body) {
  const t0 = performance.now();
  try {
    const res = await fetch(URL_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body.room_number && KEYS[body.hotel] ? { ...body, room_key: KEYS[body.hotel][body.room_number] } : body)
    });
    const status = res.status;
    if (status >= 300 && status !== 429) {
      const s = (stats[name] ||= { lat: [], ok: 0, rateLimited: 0, otherErr: 0, netErr: 0, firstErr: '' });
      if (!s.firstErr) { try { s.firstErr = status + ' ' + (await res.text()).slice(0, 120); } catch (e) {} }
    } else { await res.arrayBuffer().catch(() => {}); }
    rec(name, performance.now() - t0, status);
  } catch (e) {
    rec(name, performance.now() - t0, 0);
  }
}

// ---------- setup ----------
async function ensureHotel(slug) {
  const r = await fetch(`${URL_BASE}/api/health`).catch(() => null);
  if (!r || !r.ok) throw new Error(`Server not reachable at ${URL_BASE}/api/health`);
  const h = await fetch(`${URL_BASE}/api/hotel-info?hotel=${slug}`).catch(() => null);
  if (h && h.ok) return;
  const detail = h ? `server answered ${h.status}: ${(await h.text().catch(() => '')).slice(0, 150)}` : 'no answer from the server';
  if (!SUPER_PW) throw new Error(`Hotel "${slug}" not found (${detail}).\n` +
    `Check the exact slug in your super-admin panel (it is the "hotel=" part of a guest link), or pass --super-password to create it.`);
  const res = await fetch(`${URL_BASE}/api/super-admin/hotels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-super-admin-password': SUPER_PW },
    body: JSON.stringify({ slug, name: 'Load Test Hotel', admin_password: 'loadtest-admin-123', staff_password: 'loadtest-staff-123' })
  });
  if (!res.ok && res.status !== 409) throw new Error('Could not create hotel: ' + res.status + ' ' + (await res.text()));
}

async function loadKeys(hotel) {
  const pw = PASSWORDS[hotel];
  if (!pw) throw new Error(`No password for "${hotel}". Pass --passwords ${hotel}=<ADMIN_PASSWORD> (chat now needs room keys).`);
  const rooms = [];
  for (let n = ROOM_FROM; n <= ROOM_TO; n++) rooms.push(roomName(n));
  const res = await fetch(`${URL_BASE}/api/room-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
    body: JSON.stringify({ hotel, rooms })
  });
  if (!res.ok) throw new Error(`Could not fetch room keys for "${hotel}": ${res.status} ${(await res.text()).slice(0, 120)}`);
  KEYS[hotel] = (await res.json()).keys;
}

// ---------- sockets ----------
const sentAt = new Map();   // marker -> send timestamp
const deliveryLat = [];     // staff-socket delivery latencies (ms)
let staffReceived = 0;
let guestReceived = 0;
const sockets = [];

function roomName(n) { return ROOM_PREFIX + n; }

function connectSockets() {
  return new Promise((resolve) => {
    let connected = 0;
    const total = HOTELS.length * (ROOMS + 1);
    const done = () => { if (++connected >= total) resolve(); };
    for (const hotel of HOTELS) {
      // One staff dashboard per hotel — it receives every guest message there.
      const st = io(URL_BASE, { transports: ['websocket'], reconnection: false });
      st.on('connect', () => { st.emit('join_staff', { hotel, password: PASSWORDS[hotel] }); done(); });
      st.on('connect_error', done);
      st.on('new_message', (m) => {
        const mk = /\[LT:(\d+)\]/.exec(m.text || '');
        if (mk && sentAt.has(mk[1])) {
          deliveryLat.push(performance.now() - sentAt.get(mk[1]));
          staffReceived++;
        }
      });
      sockets.push(st);
      // One guest app per room, joined to that room's channel.
      for (let n = ROOM_FROM; n <= ROOM_TO; n++) {
        const s = io(URL_BASE, { transports: ['websocket'], reconnection: false });
        s.on('connect', () => { s.emit('join_room', { hotel, room: roomName(n), key: KEYS[hotel][roomName(n)] }); done(); });
        s.on('connect_error', done);
        s.on('new_message', () => { guestReceived++; });
        sockets.push(s);
      }
    }
    setTimeout(resolve, 30000); // never hang forever on setup
  });
}

// ---------- the simulated traffic ----------
let markerSeq = 0;
function oneEvent(hotel, room) {
  const roll = Math.random();
  if (roll < 0.60) {
    const id = String(++markerSeq);
    sentAt.set(id, performance.now());
    return call('POST /api/messages (guest chat)', '/api/messages', {
      hotel, room_number: room, sender: 'guest', lang: 'en',
      text: SAMPLE_TEXTS[Math.floor(Math.random() * SAMPLE_TEXTS.length)] + ` [LT:${id}]`
    });
  }
  if (roll < 0.80) return call('POST /api/quick-requests (request)', '/api/quick-requests', {
    hotel, room_number: room, request_type: REQUEST_TYPES[Math.floor(Math.random() * REQUEST_TYPES.length)], category: 'request', lang: 'en'
  });
  if (roll < 0.90) return call('POST /api/quick-requests (issue + photo)', '/api/quick-requests', {
    hotel, room_number: room, request_type: ISSUE_TYPES[Math.floor(Math.random() * ISSUE_TYPES.length)], category: 'issue', image: FAKE_IMAGE, lang: 'en'
  });
  if (roll < 0.95) return call('POST /api/room-service (order)', '/api/room-service', {
    hotel, room_number: room, items: [{ name: 'Club sandwich', price: 900 }, { name: 'Coffee', price: 200 }]
  });
  return call('POST /api/feedback', '/api/feedback', { hotel, room_number: room, rating: 3 + Math.floor(Math.random() * 3), comment: 'load test' });
}

async function main() {
  console.log(`Load test → ${URL_BASE}  hotels: ${HOTELS.join(', ')}`);
  console.log(`Rooms ${roomName(ROOM_FROM)} … ${roomName(ROOM_TO)} (${ROOMS} per hotel) × ${PER_ROOM} events, ${HOTELS.length} hotel(s)`);
  const total = HOTELS.length * ROOMS * PER_ROOM;
  console.log(`= ${total} requests over ${DURATION}s (~${(total / DURATION).toFixed(1)} req/s), ${HOTELS.length * ROOMS} live guest sockets\n`);

  for (const h of HOTELS) { await ensureHotel(h); await loadKeys(h); }
  console.log('Connecting sockets...');
  await connectSockets();
  const live = sockets.filter((s) => s.connected).length;
  console.log(`${live}/${sockets.length} sockets connected. Starting traffic...\n`);

  const pending = [];
  const tStart = performance.now();
  for (const hotel of HOTELS) {
    for (let r = 0; r < ROOMS; r++) {
      for (let e = 0; e < PER_ROOM; e++) {
        const room = roomName(ROOM_FROM + r);
        const delay = Math.random() * DURATION * 1000; // random arrival time within the window
        pending.push(new Promise((resolve) => setTimeout(() => oneEvent(hotel, room).then(resolve, resolve), delay)));
      }
    }
  }
  await Promise.all(pending);
  const elapsed = (performance.now() - tStart) / 1000;
  await new Promise((r) => setTimeout(r, 3000)); // let late socket events arrive

  // ---------- report ----------
  console.log('=== Results ===');
  console.log(`Finished in ${elapsed.toFixed(1)}s\n`);
  let anyProblem = false;
  for (const [name, s] of Object.entries(stats)) {
    const n = s.lat.length;
    console.log(name);
    console.log(`  requests ${n} | ok ${s.ok} | rate-limited(429) ${s.rateLimited} | server errors ${s.otherErr} | network errors ${s.netErr}`);
    console.log(`  latency  p50 ${pct(s.lat, 50).toFixed(0)}ms  p95 ${pct(s.lat, 95).toFixed(0)}ms  p99 ${pct(s.lat, 99).toFixed(0)}ms  max ${Math.max(...s.lat).toFixed(0)}ms`);
    if (s.firstErr) console.log(`  first error: ${s.firstErr}`);
    if (s.rateLimited || s.otherErr || s.netErr) anyProblem = true;
  }
  const chatSent = stats['POST /api/messages (guest chat)']?.ok || 0;
  console.log(`\nRealtime: staff dashboard received ${staffReceived}/${chatSent} guest chat messages` +
    (deliveryLat.length ? ` | delivery p50 ${pct(deliveryLat, 50).toFixed(0)}ms  p95 ${pct(deliveryLat, 95).toFixed(0)}ms  max ${Math.max(...deliveryLat).toFixed(0)}ms` : ''));
  console.log(`Guest sockets received ${guestReceived} live messages (FAQ bot replies etc.)`);

  const rl = Object.values(stats).reduce((a, s) => a + s.rateLimited, 0);
  if (rl > 0) {
    console.log(`\nNOTE: ${rl} requests were rejected with 429. The server limits write requests per IP address, and`);
    console.log(`this test sends everything from one IP — which is also what a real hotel's shared Wi-Fi looks like`);
    console.log(`to the server. Real guests on the hotel Wi-Fi would hit the same limit.`);
  }
  console.log(anyProblem ? '\nResult: problems found (see above).' : '\nResult: no errors.');
  sockets.forEach((s) => s.close());
  process.exit(0);
}

main().catch((e) => { console.error('Test failed:', e.message); process.exit(1); });
