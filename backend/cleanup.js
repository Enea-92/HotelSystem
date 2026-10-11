#!/usr/bin/env node
// Deletes the fake data created by loadtest.js: every message, quick request,
// room-service order and feedback entry whose room name starts with the test
// prefix (default "LT-"), in the hotels you list. Real rooms are never touched
// because real room numbers don't start with that prefix.
//
// Put this file in the BACKEND folder (next to models.js and .env) and run:
//   node cleanup.js --hotels bregu,seaview            (shows what it WOULD delete)
//   node cleanup.js --hotels bregu,seaview --yes      (actually deletes)
//   add --prefix "LT-" if you used a different --room-prefix
//   add --drop-hotel loadtest --yes to also delete a hotel the test created
//   node cleanup.js --list                            (lists every hotel + how much data it has)
//   node cleanup.js --reset-content seaview [--yes]   (deletes the hotel's page texts + recommendations —
//                                                      this ALSO deletes real content you typed, use only
//                                                      to wipe an old seed; hotel and passwords stay)
//   --drop-hotel also removes room notes, push subscriptions, QR list and announcements of that hotel.

require('dotenv').config();
const mongoose = require('mongoose');
const { Message, QuickRequest, RoomServiceOrder, Feedback, Hotel, AuthSettings, HotelContent, Recommendation, RoomNote, PushSubscription, GeneratedQr, Announcement } = require('./models');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const HOTELS = String(arg('hotels', '')).toLowerCase().split(',').map((h) => h.trim()).filter(Boolean);
const PREFIX = String(arg('prefix', 'LT-'));
const YES = process.argv.includes('--yes');
const DROP_HOTEL = arg('drop-hotel', '');
const LIST = process.argv.includes('--list');
const RESET = String(arg('reset-content', '') === true ? '' : arg('reset-content', '')).toLowerCase();

if (!PREFIX) { console.error('Refusing to run with an empty --prefix (it would match every room).'); process.exit(1); }
if (!LIST && !RESET && !HOTELS.length && !DROP_HOTEL) { console.error('Pass --hotels bregu,seaview (and/or --drop-hotel slug).'); process.exit(1); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI missing — run this from the backend folder that has your .env.'); process.exit(1); }

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const dbName = mongoose.connection.name;
  console.log(`Database: ${dbName}   test prefix: "${PREFIX}"   mode: ${YES ? 'DELETE' : 'dry run'}\n`);
  if (LIST) {
    const hotels = await Hotel.find({}).lean();
    for (const h of hotels) {
      const f = { hotel: h.slug };
      const [m, q, o, fb, r] = await Promise.all([Message, QuickRequest, RoomServiceOrder, Feedback, Recommendation].map((M) => M.countDocuments(f)));
      const lt = await Message.countDocuments({ hotel: h.slug, room_number: { $regex: '^' + esc(PREFIX) } });
      console.log(`${h.slug.padEnd(16)} "${h.name || ''}"  messages ${m} (LT- ${lt}) | requests ${q} | orders ${o} | feedback ${fb} | recommendations ${r}`);
    }
    await mongoose.disconnect();
    return;
  }
  if (RESET) {
    const f = { hotel: RESET };
    const nc = await HotelContent.countDocuments(f), nr = await Recommendation.countDocuments(f);
    if (YES) { await HotelContent.deleteMany(f); await Recommendation.deleteMany(f); }
    console.log(`${RESET}: ${nc} content docs + ${nr} recommendations ${YES ? 'deleted' : 'would be deleted (add --yes)'}`);
    if (!HOTELS.length && !DROP_HOTEL) { await mongoose.disconnect(); return; }
  }
  const roomFilter = { $regex: '^' + esc(PREFIX) };

  for (const hotel of HOTELS) {
    for (const [name, Model] of [['messages', Message], ['quick requests', QuickRequest], ['room-service orders', RoomServiceOrder], ['feedback', Feedback]]) {
      const filter = { hotel, room_number: roomFilter };
      const n = await Model.countDocuments(filter);
      if (YES && n) await Model.deleteMany(filter);
      console.log(`${hotel}: ${n} ${name} ${YES ? 'deleted' : 'would be deleted'}`);
    }
  }

  if (DROP_HOTEL) {
    const slug = String(DROP_HOTEL).toLowerCase();
    if (YES) {
      for (const Model of [Message, QuickRequest, RoomServiceOrder, Feedback]) await Model.deleteMany({ hotel: slug });
      await AuthSettings.deleteMany({ hotel: slug });
      for (const Model of [HotelContent, Recommendation, RoomNote, PushSubscription, GeneratedQr, Announcement]) await Model.deleteMany({ hotel: slug });
      await Hotel.deleteOne({ slug });
      console.log(`Hotel "${slug}" and all its data deleted.`);
    } else {
      console.log(`Hotel "${slug}" and all its data would be deleted (add --yes).`);
    }
  }

  if (!YES) console.log('\nNothing was deleted. Add --yes to apply.');
  await mongoose.disconnect();
})().catch((e) => { console.error('Cleanup failed:', e.message); process.exit(1); });
