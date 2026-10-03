// Mongoose models — multi-tenant: every collection is scoped by `hotel`
// (a URL-safe slug like "bregu"), so many hotels can share one database
// without ever seeing each other's data.

const mongoose = require('mongoose');

// --- Hotel registry (one document per hotel using this platform) ---
const hotelSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    active: { type: Boolean, default: true }, // deactivated hotels block guest access but keep all data
    theme: { type: String, default: 'teal' } // color preset key for the guest app (see THEME_PRESETS client-side)
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

const messageSchema = new mongoose.Schema(
  {
    hotel: { type: String, required: true, index: true },
    room_number: { type: String, required: true, index: true },
    sender: { type: String, required: true, enum: ['guest', 'staff', 'bot'] }, // 'bot' = instant FAQ auto-reply
    text: { type: String, required: true },
    lang: { type: String, default: '' }, // language the sender composed it in, for auto-translation on display
    alerted: { type: Boolean, default: false } // true once an unanswered-guest-message escalation has fired for this message
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);
messageSchema.index({ hotel: 1, room_number: 1 });
// Note: no 45-minute TTL index — messages are wiped once a day at checkout
// time instead (see runDailyWipe in server.js), per hotel.

const quickRequestSchema = new mongoose.Schema(
  {
    hotel: { type: String, required: true, index: true },
    room_number: { type: String, required: true },
    request_type: { type: String, required: true },
    category: { type: String, enum: ['request', 'issue'], default: 'request' },
    status: { type: String, default: 'pending' },
    image: { type: String, default: '' }, // optional base64 photo, mainly for issue reports (AC/TV/plumbing/etc.) — cleared daily at the 11:00 wipe
    lang: { type: String, default: '' },
    alerted: { type: Boolean, default: false } // true once an overdue-response escalation has fired for this item
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

const roomServiceOrderSchema = new mongoose.Schema(
  {
    hotel: { type: String, required: true, index: true },
    room_number: { type: String, required: true },
    items: [{ name: String, price: Number }],
    total: { type: Number, required: true },
    status: { type: String, default: 'pending' }, // pending | preparing | delivered
    delivered_at: { type: Date, default: null },
    followed_up: { type: Boolean, default: false },
    alerted: { type: Boolean, default: false } // true once an overdue-response escalation has fired for this order
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

const feedbackSchema = new mongoose.Schema(
  {
    hotel: { type: String, required: true, index: true },
    room_number: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '' }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

// Turn a Mongo document into the same plain shape the frontend already expects
// (id instead of _id, created_at as ISO string).
function toDTO(doc) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : doc;
  const { _id, __v, ...rest } = obj;
  return { id: _id.toString(), ...rest, created_at: obj.created_at ? obj.created_at.toISOString() : undefined };
}

// --- Editable hotel content (one document per hotel) ---
const langText = { sq: String, en: String, it: String, de: String, fr: String };

const hotelContentSchema = new mongoose.Schema({
  hotel: { type: String, required: true, unique: true },
  location: {
    lat: { type: Number, default: 39.7669 },
    lng: { type: Number, default: 19.9903 }
  },
  wifi: {
    ssid: { type: String, default: 'Hotel_Guest' },
    password: { type: String, default: 'guest2026' }
  },
  amenities: [{ name: langText, note: langText }],
  locations: [{ name: langText, desc: langText, time: langText }],
  room_service: [{ name: langText, price: Number, image_url: { type: String, default: '' } }],
  // Frequently asked questions, editable per hotel. Also doubles as the source
  // for the guest-chat instant auto-reply bot (see matchFaq() in server.js):
  // if a guest's message closely matches a question here, the answer is
  // posted back automatically before staff ever sees it.
  faq: [{ q: langText, a: langText }],
  // Toggles that let a hotel hide entire sections from the guest app —
  // e.g. no room service if the hotel has no restaurant. Everything
  // defaults to visible so existing hotels are unaffected.
  enabled_sections: {
    wifi: { type: Boolean, default: true },
    amenities: { type: Boolean, default: true },
    locations: { type: Boolean, default: true },
    room_service: { type: Boolean, default: true },
    quick_requests: { type: Boolean, default: true },
    toiletries: { type: Boolean, default: true },
    dnd: { type: Boolean, default: true },
    issues: { type: Boolean, default: true },
    restaurants: { type: Boolean, default: true },
    bars: { type: Boolean, default: true },
    beaches: { type: Boolean, default: true },
    info_hours: { type: Boolean, default: true },
    info_transport: { type: Boolean, default: true },
    info_emergency: { type: Boolean, default: true },
    info_faq: { type: Boolean, default: true }
  }
});

// --- Recommendations (restaurants / bars / beaches), each with real coordinates ---
const recommendationSchema = new mongoose.Schema({
  hotel: { type: String, required: true, index: true },
  category: { type: String, required: true, enum: ['restorante', 'bare', 'plazhe'] },
  name: { type: String, required: true },
  price_type: { type: String, enum: ['free', 'mid', 'high'], default: 'mid' },
  meta: langText,
  tip: langText,
  staff_pick: { type: Boolean, default: false },
  image_url: { type: String, default: '' },
  lat: Number,
  lng: Number
});

// --- Auth: admin/staff passwords stored as bcrypt hashes, one pair per hotel.
// The *_plain copies exist only so the super-admin can look a hotel's current
// credentials back up (e.g. to hand them to hotel staff) — they're never
// used for login checks, and no non-super-admin endpoint returns them. ---
const authSettingsSchema = new mongoose.Schema({
  hotel: { type: String, required: true, unique: true },
  admin_password_hash: { type: String, required: true },
  staff_password_hash: { type: String, required: true },
  admin_password_plain: { type: String, default: '' },
  staff_password_plain: { type: String, default: '' }
});

// --- Per-room notes/instructions — admin can apply the same note to one or
// many rooms at once (e.g. "this room has a jacuzzi", "quiet room, no balcony").
const roomNoteSchema = new mongoose.Schema(
  {
    hotel: { type: String, required: true, index: true },
    room_number: { type: String, required: true },
    note: langText
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);
roomNoteSchema.index({ hotel: 1, room_number: 1 }, { unique: true });

// --- Web Push subscriptions — one per device/browser install, tied to a
// hotel + room so a staff reply can trigger a real phone notification even
// if the guest app isn't open.
const pushSubscriptionSchema = new mongoose.Schema(
  {
    hotel: { type: String, required: true, index: true },
    room_number: { type: String, required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true }
    }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

// --- Generated QR codes — a persistent record of every room QR the admin
// has created, so the list survives page reloads (not just an in-browser
// session). The QR image itself is regenerated on demand from these fields
// (room + floor + app URL), never stored as binary data.
const generatedQrSchema = new mongoose.Schema(
  {
    hotel: { type: String, required: true, index: true },
    room_number: { type: String, required: true },
    floor: { type: String, default: '' },
    app_url: { type: String, required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);
generatedQrSchema.index({ hotel: 1, room_number: 1 }, { unique: true });

// --- Announcement: one active banner per hotel, broadcast live to every
// guest currently in the app (e.g. "Pool closed today for maintenance").
// Only one is kept per hotel — setting a new one replaces the old one.
const announcementSchema = new mongoose.Schema(
  {
    hotel: { type: String, required: true, unique: true },
    text: langText,
    active: { type: Boolean, default: false },
    expires_at: { type: Date, default: null }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

module.exports = {
  Hotel: mongoose.model('Hotel', hotelSchema),
  Message: mongoose.model('Message', messageSchema),
  QuickRequest: mongoose.model('QuickRequest', quickRequestSchema),
  RoomServiceOrder: mongoose.model('RoomServiceOrder', roomServiceOrderSchema),
  Feedback: mongoose.model('Feedback', feedbackSchema),
  HotelContent: mongoose.model('HotelContent', hotelContentSchema),
  Recommendation: mongoose.model('Recommendation', recommendationSchema),
  AuthSettings: mongoose.model('AuthSettings', authSettingsSchema),
  RoomNote: mongoose.model('RoomNote', roomNoteSchema),
  PushSubscription: mongoose.model('PushSubscription', pushSubscriptionSchema),
  GeneratedQr: mongoose.model('GeneratedQr', generatedQrSchema),
  Announcement: mongoose.model('Announcement', announcementSchema),
  toDTO
};
