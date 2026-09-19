// Hotel Bregu platform — multi-tenant backend. Every hotel is identified by
// a URL-safe slug (e.g. "bregu"), passed as ?hotel=bregu on every request.
// One MongoDB database holds every hotel's data, scoped by that slug.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const webpush = require('web-push');
const {
  Hotel, Message, QuickRequest, RoomServiceOrder, Feedback,
  HotelContent, Recommendation, AuthSettings, RoomNote, PushSubscription, toDTO
} = require('./models');

const app = express();
app.use(cors());
app.use(express.json());

const FOLLOWUP_HOURS = Number(process.env.FOLLOWUP_HOURS || 2);
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'change-me-super-admin';

// ============ Web Push (VAPID) setup ============
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
const pushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — push notifications to guests are disabled.');
}

async function sendPushToRoom(hotel, room_number, title, body) {
  if (!pushEnabled) return;
  const subs = await PushSubscription.find({ hotel, room_number });
  const payload = JSON.stringify({ title, body });
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await PushSubscription.deleteOne({ _id: sub._id });
      } else {
        console.warn('Push send failed:', err.message);
      }
    }
  }));
}

// ============ Signed room-session tokens (optional expiring QR codes) ============
const SESSION_SECRET = process.env.SESSION_SECRET || 'bregu-dev-secret-change-me';
if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET not set — using an insecure default. Set it in .env / Render for production.');
}
function base64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function base64urlDecode(str) { return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }
function signSessionToken(payload) {
  const data = base64url(Buffer.from(JSON.stringify(payload)));
  const sig = base64url(crypto.createHmac('sha256', SESSION_SECRET).update(data).digest());
  return data + '.' + sig;
}
function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expectedSig = base64url(crypto.createHmac('sha256', SESSION_SECRET).update(data).digest());
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(base64urlDecode(data).toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) { return null; }
}

// ============ Auth middleware (per-hotel) ============
const authSettingsCache = new Map(); // hotel slug -> AuthSettings doc

async function getAuthSettings(hotel) {
  if (authSettingsCache.has(hotel)) return authSettingsCache.get(hotel);
  const settings = await AuthSettings.findOne({ hotel });
  if (settings) authSettingsCache.set(hotel, settings);
  return settings;
}

// Resolves req.hotel from query (?hotel=), body, or params, and confirms it exists.
async function requireHotel(req, res, next) {
  const hotel = (req.query.hotel || req.body.hotel || req.params.hotel || '').toLowerCase().trim();
  if (!hotel) return res.status(400).json({ error: 'hotel (slug) required' });
  const exists = await Hotel.findOne({ slug: hotel });
  if (!exists) return res.status(404).json({ error: 'Hoteli nuk ekziston' });
  req.hotel = hotel;
  next();
}

async function requireAdmin(req, res, next) {
  try {
    const hotel = (req.query.hotel || req.body.hotel || req.params.hotel || '').toLowerCase().trim();
    if (!hotel) return res.status(400).json({ error: 'hotel (slug) required' });
    const settings = await getAuthSettings(hotel);
    if (!settings) return res.status(404).json({ error: 'Hoteli nuk ekziston' });
    const provided = req.headers['x-admin-password'] || '';
    const ok = await bcrypt.compare(provided, settings.admin_password_hash);
    if (!ok) return res.status(401).json({ error: 'Fjalëkalim admin i pasaktë' });
    req.hotel = hotel;
    next();
  } catch (err) { res.status(500).json({ error: 'Gabim autentikimi' }); }
}

async function requireStaff(req, res, next) {
  try {
    const hotel = (req.query.hotel || req.body.hotel || req.params.hotel || '').toLowerCase().trim();
    if (!hotel) return res.status(400).json({ error: 'hotel (slug) required' });
    const settings = await getAuthSettings(hotel);
    if (!settings) return res.status(404).json({ error: 'Hoteli nuk ekziston' });
    const provided = req.headers['x-staff-password'] || '';
    const okStaff = await bcrypt.compare(provided, settings.staff_password_hash);
    const okAdmin = await bcrypt.compare(provided, settings.admin_password_hash);
    if (!okStaff && !okAdmin) return res.status(401).json({ error: 'Fjalëkalim stafi i pasaktë' });
    req.hotel = hotel;
    next();
  } catch (err) { res.status(500).json({ error: 'Gabim autentikimi' }); }
}

function requireSuperAdmin(req, res, next) {
  if (req.headers['x-super-admin-password'] !== SUPER_ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Fjalëkalim super-admin i pasaktë' });
  }
  next();
}

// ============ Rate limiting ============
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Shumë kërkesa njëherësh, provo përsëri pas pak.' }
});
app.use('/api/messages', writeLimiter);
app.use('/api/quick-requests', writeLimiter);
app.use('/api/room-service', writeLimiter);
app.use('/api/feedback', writeLimiter);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

function roomChannel(hotel, room) { return hotel + ':room:' + room; }
function staffChannel(hotel) { return hotel + ':staff'; }

io.on('connection', (socket) => {
  socket.on('join_room', ({ hotel, room }) => { if (hotel && room) socket.join(roomChannel(hotel, room)); });
  socket.on('join_staff', (hotel) => { if (hotel) socket.join(staffChannel(hotel)); });
});

// Optional enforcement for guest actions: if the request includes a
// session_token, it must be valid and match the room being acted on.
function verifyGuestSession(req, res, next) {
  const token = req.body.session_token;
  if (!token) return next();
  const payload = verifySessionToken(token);
  if (!payload) return res.status(401).json({ error: 'Sesioni ka skaduar, skano përsëri kodin QR.' });
  if (String(payload.room) !== String(req.body.room_number)) {
    return res.status(401).json({ error: 'Token i pavlefshëm për këtë dhomë.' });
  }
  next();
}

// ============ CHAT ============

app.post('/api/messages', requireHotel, verifyGuestSession, async (req, res) => {
  const { room_number, sender, text } = req.body;
  if (!room_number || !sender || !text) return res.status(400).json({ error: 'room_number, sender, text required' });
  const doc = await Message.create({ hotel: req.hotel, room_number, sender, text });
  const message = toDTO(doc);

  io.to(roomChannel(req.hotel, room_number)).to(staffChannel(req.hotel)).emit('new_message', message);

  if (sender === 'staff') {
    sendPushToRoom(req.hotel, room_number, 'Mesazh nga recepsioni', text).catch(() => {});
  }

  res.status(201).json(message);
});

app.get('/api/messages/:room', requireHotel, async (req, res) => {
  const docs = await Message.find({ hotel: req.hotel, room_number: req.params.room }).sort({ created_at: 1 });
  res.json(docs.map(toDTO));
});

app.get('/api/messages', requireStaff, async (req, res) => {
  const docs = await Message.find({ hotel: req.hotel }).sort({ created_at: -1 }).limit(200);
  res.json(docs.map(toDTO));
});

// ============ QUICK REQUESTS ============

app.post('/api/quick-requests', requireHotel, verifyGuestSession, async (req, res) => {
  const { room_number, request_type, category } = req.body;
  if (!room_number || !request_type) return res.status(400).json({ error: 'room_number, request_type required' });
  const doc = await QuickRequest.create({ hotel: req.hotel, room_number, request_type, category: category === 'issue' ? 'issue' : 'request' });
  const item = toDTO(doc);
  io.to(staffChannel(req.hotel)).emit('new_request', item);
  res.status(201).json(item);
});

app.get('/api/quick-requests', requireStaff, async (req, res) => {
  const docs = await QuickRequest.find({ hotel: req.hotel, status: 'pending' }).sort({ created_at: -1 });
  res.json(docs.map(toDTO));
});

app.patch('/api/quick-requests/:id', requireStaff, async (req, res) => {
  const doc = await QuickRequest.findOneAndUpdate({ _id: req.params.id, hotel: req.hotel }, { status: req.body.status || 'done' }, { new: true });
  const item = toDTO(doc);
  io.to(staffChannel(req.hotel)).emit('request_updated', item);
  res.json(item);
});

// ============ ROOM SERVICE ORDERS ============

app.post('/api/room-service', requireHotel, verifyGuestSession, async (req, res) => {
  const { room_number, items } = req.body;
  if (!room_number || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'room_number and non-empty items[] required' });
  }
  const total = items.reduce((sum, i) => sum + (Number(i.price) || 0), 0);
  const doc = await RoomServiceOrder.create({ hotel: req.hotel, room_number, items, total });
  const order = toDTO(doc);
  io.to(staffChannel(req.hotel)).emit('new_order', order);
  res.status(201).json(order);
});

app.get('/api/room-service', requireStaff, async (req, res) => {
  const docs = await RoomServiceOrder.find({ hotel: req.hotel, status: { $ne: 'delivered' } }).sort({ created_at: -1 });
  res.json(docs.map(toDTO));
});

app.patch('/api/room-service/:id', requireStaff, async (req, res) => {
  const changes = { status: req.body.status };
  if (req.body.status === 'delivered') changes.delivered_at = new Date();
  const doc = await RoomServiceOrder.findOneAndUpdate({ _id: req.params.id, hotel: req.hotel }, changes, { new: true });
  const order = toDTO(doc);
  io.to(roomChannel(req.hotel, order.room_number)).to(staffChannel(req.hotel)).emit('order_updated', order);
  res.json(order);
});

// ============ FEEDBACK ============

app.post('/api/feedback', requireHotel, verifyGuestSession, async (req, res) => {
  const { room_number, rating, comment } = req.body;
  if (!room_number || !rating) return res.status(400).json({ error: 'room_number, rating required' });
  const doc = await Feedback.create({ hotel: req.hotel, room_number, rating, comment: comment || '' });
  res.status(201).json(toDTO(doc));
});

app.get('/api/feedback', requireStaff, async (req, res) => {
  const docs = await Feedback.find({ hotel: req.hotel }).sort({ created_at: -1 }).limit(100);
  res.json(docs.map(toDTO));
});

// ============ HOTEL INFO (public display name) ============

app.get('/api/hotel-info', requireHotel, async (req, res) => {
  const hotel = await Hotel.findOne({ slug: req.hotel });
  res.json({ slug: req.hotel, name: hotel ? hotel.name : req.hotel });
});

// ============ HOTEL CONTENT (editable via admin panel) ============

app.get('/api/content', requireHotel, async (req, res) => {
  let content = await HotelContent.findOne({ hotel: req.hotel });
  if (!content) content = await HotelContent.create({ hotel: req.hotel });
  res.json(toDTO(content));
});

app.put('/api/content', requireAdmin, async (req, res) => {
  let content = await HotelContent.findOne({ hotel: req.hotel });
  if (!content) content = new HotelContent({ hotel: req.hotel });
  const { hotel, ...rest } = req.body;
  Object.assign(content, rest);
  await content.save();
  io.emit('content_updated', { hotel: req.hotel });
  res.json(toDTO(content));
});

// ============ RECOMMENDATIONS ============

app.get('/api/recommendations', requireHotel, async (req, res) => {
  const docs = await Recommendation.find({ hotel: req.hotel });
  res.json(docs.map(toDTO));
});

app.post('/api/recommendations', requireAdmin, async (req, res) => {
  const doc = await Recommendation.create({ ...req.body, hotel: req.hotel });
  io.emit('content_updated', { hotel: req.hotel });
  res.status(201).json(toDTO(doc));
});

app.put('/api/recommendations/:id', requireAdmin, async (req, res) => {
  const { hotel, ...rest } = req.body;
  const doc = await Recommendation.findOneAndUpdate({ _id: req.params.id, hotel: req.hotel }, rest, { new: true });
  io.emit('content_updated', { hotel: req.hotel });
  res.json(toDTO(doc));
});

app.delete('/api/recommendations/:id', requireAdmin, async (req, res) => {
  await Recommendation.deleteOne({ _id: req.params.id, hotel: req.hotel });
  io.emit('content_updated', { hotel: req.hotel });
  res.json({ deleted: true });
});

// ============ ROOM NOTES (per-room instructions, editable for 1 or many rooms at once) ============

app.get('/api/room-notes/:room', requireHotel, async (req, res) => {
  const doc = await RoomNote.findOne({ hotel: req.hotel, room_number: req.params.room });
  res.json(doc ? toDTO(doc) : null);
});

app.get('/api/room-notes', requireAdmin, async (req, res) => {
  const docs = await RoomNote.find({ hotel: req.hotel }).sort({ room_number: 1 });
  res.json(docs.map(toDTO));
});

app.post('/api/room-notes/bulk', requireAdmin, async (req, res) => {
  const { rooms, note } = req.body;
  if (!Array.isArray(rooms) || rooms.length === 0 || !note) {
    return res.status(400).json({ error: 'rooms[] and note required' });
  }
  const results = await Promise.all(rooms.map((room) =>
    RoomNote.findOneAndUpdate(
      { hotel: req.hotel, room_number: String(room) },
      { hotel: req.hotel, room_number: String(room), note },
      { upsert: true, new: true }
    )
  ));
  io.emit('content_updated', { hotel: req.hotel });
  res.json(results.map(toDTO));
});

app.delete('/api/room-notes/:room', requireAdmin, async (req, res) => {
  await RoomNote.deleteOne({ hotel: req.hotel, room_number: req.params.room });
  io.emit('content_updated', { hotel: req.hotel });
  res.json({ deleted: true });
});

// ============ STATS (staff dashboard) ============

app.get('/api/stats', requireStaff, async (req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [requestsToday, ordersToday, feedbackToday, allFeedback] = await Promise.all([
    QuickRequest.countDocuments({ hotel: req.hotel, created_at: { $gte: startOfDay } }),
    RoomServiceOrder.countDocuments({ hotel: req.hotel, created_at: { $gte: startOfDay } }),
    Feedback.countDocuments({ hotel: req.hotel, created_at: { $gte: startOfDay } }),
    Feedback.find({ hotel: req.hotel })
  ]);

  const avgRating = allFeedback.length
    ? (allFeedback.reduce((sum, f) => sum + f.rating, 0) / allFeedback.length).toFixed(1)
    : null;

  const hourCounts = new Array(24).fill(0);
  const [reqsToday, ordsToday] = await Promise.all([
    QuickRequest.find({ hotel: req.hotel, created_at: { $gte: startOfDay } }),
    RoomServiceOrder.find({ hotel: req.hotel, created_at: { $gte: startOfDay } })
  ]);
  [...reqsToday, ...ordsToday].forEach(doc => { hourCounts[new Date(doc.created_at).getHours()]++; });
  const busiestHour = hourCounts.indexOf(Math.max(...hourCounts));

  res.json({
    requests_today: requestsToday,
    orders_today: ordersToday,
    feedback_today: feedbackToday,
    avg_rating: avgRating,
    busiest_hour: hourCounts.some(c => c > 0) ? busiestHour : null
  });
});

// ============ CSV EXPORT ============

function toCsv(rows, columns) {
  const header = columns.join(',');
  const lines = rows.map(row => columns.map(col => {
    let val = row[col];
    if (val === undefined || val === null) val = '';
    val = String(val).replace(/"/g, '""');
    return /[",\n]/.test(val) ? `"${val}"` : val;
  }).join(','));
  return [header, ...lines].join('\n');
}

app.get('/api/export/feedback.csv', requireStaff, async (req, res) => {
  const docs = await Feedback.find({ hotel: req.hotel }).sort({ created_at: -1 });
  const csv = toCsv(docs.map(toDTO), ['id', 'room_number', 'rating', 'comment', 'created_at']);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="feedback.csv"');
  res.send(csv);
});

app.get('/api/export/orders.csv', requireStaff, async (req, res) => {
  const docs = await RoomServiceOrder.find({ hotel: req.hotel }).sort({ created_at: -1 });
  const rows = docs.map(d => {
    const dto = toDTO(d);
    return { ...dto, items: dto.items.map(i => i.name).join(' | ') };
  });
  const csv = toCsv(rows, ['id', 'room_number', 'items', 'total', 'status', 'created_at']);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
  res.send(csv);
});

// ============ WEB PUSH (guest phone notifications) ============

app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: pushEnabled ? VAPID_PUBLIC_KEY : null });
});

app.post('/api/push/subscribe', requireHotel, async (req, res) => {
  const { room_number, subscription } = req.body;
  if (!room_number || !subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: 'room_number and subscription required' });
  }
  await PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    { hotel: req.hotel, room_number, endpoint: subscription.endpoint, keys: subscription.keys },
    { upsert: true }
  );
  res.status(201).json({ ok: true });
});

app.post('/api/push/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  await PushSubscription.deleteOne({ endpoint });
  res.json({ ok: true });
});

// ============ ROOM SESSION TOKENS (optional expiring QR codes) ============

app.post('/api/session/issue', requireStaff, (req, res) => {
  const { room, floor, hours } = req.body;
  if (!room) return res.status(400).json({ error: 'room required' });
  const validHours = Number(hours) > 0 ? Number(hours) : 3;
  const exp = Date.now() + validHours * 60 * 60 * 1000;
  const token = signSessionToken({ hotel: req.hotel, room: String(room), floor: floor ? String(floor) : '', exp });
  res.json({ token, exp, room: String(room), floor: floor ? String(floor) : '' });
});

app.get('/api/session/verify', (req, res) => {
  const payload = verifySessionToken(req.query.token);
  if (!payload) return res.status(401).json({ valid: false });
  res.json({ valid: true, hotel: payload.hotel, room: payload.room, floor: payload.floor, exp: payload.exp });
});

// ============ SUPER ADMIN (create/manage hotels) ============

app.post('/api/super-admin/hotels', requireSuperAdmin, async (req, res) => {
  const { slug, name, admin_password, staff_password } = req.body;
  if (!slug || !name || !admin_password || !staff_password) {
    return res.status(400).json({ error: 'slug, name, admin_password, staff_password required' });
  }
  const cleanSlug = String(slug).toLowerCase().trim().replace(/[^a-z0-9-]/g, '');
  if (!cleanSlug) return res.status(400).json({ error: 'slug i pavlefshëm' });

  const existing = await Hotel.findOne({ slug: cleanSlug });
  if (existing) return res.status(409).json({ error: 'Ky slug ekziston tashmë' });

  const hotel = await Hotel.create({ slug: cleanSlug, name });
  const adminHash = await bcrypt.hash(admin_password, 10);
  const staffHash = await bcrypt.hash(staff_password, 10);
  await AuthSettings.create({ hotel: cleanSlug, admin_password_hash: adminHash, staff_password_hash: staffHash });
  await HotelContent.create({ hotel: cleanSlug });

  res.status(201).json(toDTO(hotel));
});

app.get('/api/super-admin/hotels', requireSuperAdmin, async (req, res) => {
  const docs = await Hotel.find().sort({ created_at: -1 });
  res.json(docs.map(toDTO));
});

app.delete('/api/super-admin/hotels/:slug', requireSuperAdmin, async (req, res) => {
  const hotel = req.params.slug;
  await Promise.all([
    Hotel.deleteOne({ slug: hotel }),
    AuthSettings.deleteOne({ hotel }),
    HotelContent.deleteOne({ hotel }),
    Message.deleteMany({ hotel }),
    QuickRequest.deleteMany({ hotel }),
    RoomServiceOrder.deleteMany({ hotel }),
    Feedback.deleteMany({ hotel }),
    Recommendation.deleteMany({ hotel }),
    RoomNote.deleteMany({ hotel }),
    PushSubscription.deleteMany({ hotel })
  ]);
  authSettingsCache.delete(hotel);
  res.json({ deleted: true });
});

// ============ health check ============
app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'connected' : 'not connected' });
});

// ============ keep-alive self-ping ============
// Render's free tier spins the service down after ~15 minutes with no
// incoming HTTP requests. If SELF_PING_URL is set (your own public backend
// URL), the server pings its own /api/health every 10 minutes — well under
// that threshold — so it never spins down on its own. This only keeps an
// already-running server awake; it can't wake a service that's already
// asleep (only real incoming traffic, e.g. a guest opening the app, does
// that — which then takes Render ~30-50s to respond to, same as always).
const SELF_PING_URL = process.env.SELF_PING_URL;
if (SELF_PING_URL) {
  setInterval(() => {
    fetch(SELF_PING_URL.replace(/\/$/, '') + '/api/health').catch(() => {});
  }, 10 * 60 * 1000);
  console.log('Self-ping keep-alive enabled, pinging', SELF_PING_URL, 'every 10 minutes.');
} else {
  console.log('SELF_PING_URL not set — server will spin down after ~15 min idle on Render free tier.');
}

// ============ daily message wipe (11:00, Europe/Tirane time — checkout) ============
let lastWipeDate = null;

async function checkDailyWipe() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Tirane', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date());
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    const dateStr = `${map.year}-${map.month}-${map.day}`;
    const hour = parseInt(map.hour, 10);
    const minute = parseInt(map.minute, 10);

    if (hour === 11 && minute === 0 && lastWipeDate !== dateStr) {
      const result = await Message.deleteMany({});
      lastWipeDate = dateStr;
      io.emit('chat_cleared');
      console.log(`Daily message wipe at 11:00 (Europe/Tirane): deleted ${result.deletedCount} messages across all hotels.`);
    }
  } catch (err) {
    console.error('Daily wipe check failed:', err.message);
  }
}
setInterval(checkDailyWipe, 60 * 1000);

async function dropLegacyTtlIndex() {
  try {
    const indexes = await Message.collection.indexes();
    const ttlIndex = indexes.find((idx) => idx.expireAfterSeconds !== undefined);
    if (ttlIndex) {
      await Message.collection.dropIndex(ttlIndex.name);
      console.log('Dropped legacy TTL index on messages:', ttlIndex.name);
    }
  } catch (err) {
    console.warn('Could not check/drop legacy TTL index:', err.message);
  }
}

// ============ follow-up scheduler (across all hotels) ============
async function runFollowUpCheck() {
  try {
    const cutoff = new Date(Date.now() - FOLLOWUP_HOURS * 60 * 60 * 1000);
    const dueOrders = await RoomServiceOrder.find({
      status: 'delivered',
      followed_up: false,
      delivered_at: { $ne: null, $lte: cutoff }
    });
    for (const order of dueOrders) {
      const text = 'Shpresojmë t\'ju ketë pëlqyer porosia! Nëse ju duhet diçka tjetër, jemi këtu. 🙂';
      const msgDoc = await Message.create({ hotel: order.hotel, room_number: order.room_number, sender: 'staff', text });
      const message = toDTO(msgDoc);
      io.to(roomChannel(order.hotel, order.room_number)).to(staffChannel(order.hotel)).emit('new_message', message);
      order.followed_up = true;
      await order.save();
    }
  } catch (err) {
    console.error('Follow-up check failed:', err.message);
  }
}
setInterval(runFollowUpCheck, 5 * 60 * 1000);

const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI. Copy .env.example to .env and fill in your connection string.');
  process.exit(1);
}

mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    await dropLegacyTtlIndex();
    server.listen(PORT, () => console.log('Hotel platform backend running on port ' + PORT));
    runFollowUpCheck();
    checkDailyWipe();
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
