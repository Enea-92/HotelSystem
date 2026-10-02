// One-time seed script — populates the editable hotel content and the
// example recommendations, using the same placeholder text that was
// hardcoded in the guest app before. Run once after connecting a fresh
// database:  node seed.js
// Safe to re-run: it skips seeding anything that already exists.

require('dotenv').config();
const mongoose = require('mongoose');
const { Hotel, HotelContent, Recommendation, AuthSettings } = require('./models');

const lt = (sq, en, it, de) => ({ sq, en, it, de });

// Usage: node seed.js [hotel-slug]  (defaults to "bregu")
const HOTEL_SLUG = process.argv[2] || 'bregu';

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB for seeding hotel:', HOTEL_SLUG);

  let hotel = await Hotel.findOne({ slug: HOTEL_SLUG });
  if (!hotel) {
    hotel = await Hotel.create({ slug: HOTEL_SLUG, name: 'Hotel Bregu' });
    console.log('Created Hotel registry entry for', HOTEL_SLUG);
  }

  const existingAuth = await AuthSettings.findOne({ hotel: HOTEL_SLUG });
  if (!existingAuth) {
    const bcrypt = require('bcryptjs');
    const adminHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'bregu-admin', 10);
    const staffHash = await bcrypt.hash(process.env.STAFF_PASSWORD || 'bregu-staff', 10);
    await AuthSettings.create({ hotel: HOTEL_SLUG, admin_password_hash: adminHash, staff_password_hash: staffHash });
    console.log('Created initial admin/staff passwords for', HOTEL_SLUG, '(from .env ADMIN_PASSWORD/STAFF_PASSWORD)');
  }

  const existingContent = await HotelContent.findOne({ hotel: HOTEL_SLUG });
  if (existingContent) {
    console.log('HotelContent already exists — skipping content seed.');
  } else {
    await HotelContent.create({
      hotel: HOTEL_SLUG,
      location: { lat: 39.7669, lng: 19.9903 }, // Ksamil, Albania — example location
      wifi: { ssid: 'Bregu_Guest', password: 'bregu2026sun' },
      amenities: [
        { name: lt('Klima', 'Air conditioning', 'Aria condizionata', 'Klimaanlage'),
          note: lt('Kontrolli në murin pranë derës së banjës. 18-26°C.', 'Control panel by the bathroom door. 18-26°C.', 'Pannello vicino alla porta del bagno. 18-26°C.', 'Bedienfeld neben der Badezimmertür. 18-26°C.') },
        { name: lt('Kasaforta', 'Safe', 'Cassaforte', 'Safe'),
          note: lt('Në dollap. Vendosni kod 4-shifror, mbyllet automatikisht.', 'Inside the closet. Set a 4-digit code, locks automatically.', "Nell'armadio. Impostate un codice a 4 cifre, si blocca automaticamente.", 'Im Kleiderschrank. 4-stelligen Code einstellen, schließt automatisch.') },
        { name: lt('Minibar', 'Minibar', 'Minibar', 'Minibar'),
          note: lt('Ujë falas. Pjesa tjetër faturohet në check-out.', 'Water is free. Everything else is billed at check-out.', "L'acqua è gratuita. Il resto viene addebitato al check-out.", 'Wasser ist kostenlos. Alles andere wird beim Check-out berechnet.') },
        { name: lt('Tharëse flokësh', 'Hairdryer', 'Asciugacapelli', 'Haartrockner'),
          note: lt('Sirtari i parë i tavolinës së make-up.', 'Top drawer of the vanity desk.', 'Primo cassetto della scrivania.', 'Oberste Schublade am Schminktisch.') }
      ],
      locations: [
        { name: lt('Recepsioni', 'Front desk', 'Reception', 'Rezeption'),
          desc: lt('Kati përdhes, tek hyrja kryesore.', 'Ground floor, at the main entrance.', "Piano terra, all'ingresso principale.", 'Erdgeschoss, am Haupteingang.'),
          time: lt('~1 min nga dhoma', '~1 min from your room', '~1 min dalla camera', '~1 Min. vom Zimmer') },
        { name: lt('Mëngjesi', 'Breakfast', 'Colazione', 'Frühstück'),
          desc: lt('Sallë me terracë, kati përdhes, në krah të recepsionit. 07:30–10:30.', 'Terrace room, ground floor, next to the front desk. 7:30–10:30 am.', 'Sala con terrazza, piano terra, accanto alla reception. 7:30–10:30.', 'Terrassenraum, Erdgeschoss, neben der Rezeption. 7:30–10:30 Uhr.'),
          time: lt('~2 min nga dhoma', '~2 min from your room', '~2 min dalla camera', '~2 Min. vom Zimmer') },
        { name: lt('Pishina', 'Pool', 'Piscina', 'Pool'),
          desc: lt('Kati i parë, dalja nga korridori pas ashensorit.', 'First floor, exit the hallway past the elevator.', "Primo piano, in fondo al corridoio dopo l'ascensore.", 'Erster Stock, Ausgang am Ende des Flurs nach dem Aufzug.'),
          time: lt('~3 min nga dhoma', '~3 min from your room', '~3 min dalla camera', '~3 Min. vom Zimmer') },
        { name: lt('Ashensori', 'Elevator', 'Ascensore', 'Aufzug'),
          desc: lt('Në fund të korridorit tuaj, majtas.', 'End of your hallway, to the left.', 'In fondo al vostro corridoio, a sinistra.', 'Am Ende Ihres Flurs, links.'),
          time: lt('~30 sek nga dhoma', '~30 sec from your room', '~30 sec dalla camera', '~30 Sek. vom Zimmer') }
      ],
      room_service: [
        { name: lt('Sanduiç Club', 'Club sandwich', 'Club sandwich', 'Club Sandwich'), price: 450 },
        { name: lt('Sallatë Greke', 'Greek salad', 'Insalata greca', 'Griechischer Salat'), price: 400 },
        { name: lt('Ujë / Bibitë', 'Water / soft drink', 'Acqua / bibita', 'Wasser / Softdrink'), price: 150 },
        { name: lt('Verë vendi (gotë)', 'House wine (glass)', 'Vino della casa (calice)', 'Hauswein (Glas)'), price: 350 }
      ]
    });
    console.log('Seeded HotelContent.');
  }

  const existingRecs = await Recommendation.countDocuments({ hotel: HOTEL_SLUG });
  if (existingRecs > 0) {
    console.log('Recommendations already exist — skipping recommendations seed.');
  } else {
    await Recommendation.insertMany([
      {
        hotel: HOTEL_SLUG,
        category: 'restorante', name: 'Taverna e Gjelbër', price_type: 'mid', staff_pick: true,
        lat: 39.7681, lng: 19.9922,
        meta: lt('Peshk i freskët · 8 min në këmbë', 'Fresh fish · 8 min walk', 'Pesce fresco · 8 min a piedi', 'Frischer Fisch · 8 Min. zu Fuß'),
        tip: lt('Kërkoni tavolinë në oborr në mbrëmje. Rezervoni nga ora 19:00 e tutje, mbushet shpejt.', 'Ask for a courtyard table in the evening. Book from 7pm onward, it fills up fast.', 'Chiedete un tavolo in cortile la sera. Prenotate dalle 19:00, si riempie in fretta.', 'Bitten Sie abends um einen Tisch im Innenhof. Ab 19 Uhr reservieren, wird schnell voll.')
      },
      {
        hotel: HOTEL_SLUG, category: 'restorante', name: 'Bujtina Ilira', price_type: 'high', staff_pick: false,
        lat: 39.7648, lng: 19.9938,
        meta: lt('Kuzhinë tradicionale · 12 min me makinë', 'Traditional cuisine · 12 min by car', 'Cucina tradizionale · 12 min in auto', 'Traditionelle Küche · 12 Min. mit dem Auto'),
        tip: lt('E mirë për darkë romantike. Porosisni qengjin në hell, gatuhet me porosi.', 'Great for a romantic dinner. Order the spit-roast lamb, made to order.', "Ottimo per una cena romantica. Ordinate l'agnello allo spiedo, preparato su richiesta.", 'Toll für ein romantisches Abendessen. Bestellen Sie das Spießlamm, auf Bestellung zubereitet.')
      },
      {
        hotel: HOTEL_SLUG, category: 'bare', name: 'Molo Bar', price_type: 'mid', staff_pick: true,
        lat: 39.7659, lng: 19.9887,
        meta: lt('Koktej mbi det · 5 min në këmbë', 'Cocktails over the sea · 5 min walk', 'Cocktail sul mare · 5 min a piedi', 'Cocktails am Meer · 5 Min. zu Fuß'),
        tip: lt('Perëndimi më i mirë i diellit në zonë. Shkoni para 20:00 për vend ulur.', 'Best sunset view around. Arrive before 8pm for a seat.', 'Il tramonto più bello della zona. Arrivate prima delle 20:00 per un posto.', 'Der schönste Sonnenuntergang der Gegend. Vor 20 Uhr kommen für einen Platz.')
      },
      {
        hotel: HOTEL_SLUG, category: 'bare', name: 'Kanto Lounge', price_type: 'mid', staff_pick: false,
        lat: 39.7695, lng: 19.9915,
        meta: lt('Muzikë live e enjte-shtunë · 10 min në këmbë', 'Live music Thu-Sat · 10 min walk', 'Musica dal vivo gio-sab · 10 min a piedi', 'Live-Musik Do-Sa · 10 Min. zu Fuß'),
        tip: lt('Fillon rreth orës 22:00, atmosferë e gjallë deri vonë.', 'Starts around 10pm, lively atmosphere late into the night.', "Inizia verso le 22:00, atmosfera vivace fino a tardi.", 'Beginnt gegen 22 Uhr, lebendige Atmosphäre bis spät in die Nacht.')
      },
      {
        hotel: HOTEL_SLUG, category: 'plazhe', name: 'Plazhi i Kaltër', price_type: 'free', staff_pick: true,
        lat: 39.7635, lng: 19.9871,
        meta: lt('Zhavor i imët, ujë i qetë · 6 min në këmbë', 'Fine gravel, calm water · 6 min walk', 'Ghiaia fine, acqua calma · 6 min a piedi', 'Feiner Kies, ruhiges Wasser · 6 Min. zu Fuß'),
        tip: lt('Më pak i populluar në orët e para të mëngjesit. Ombrellat me qira në vend.', 'Quieter in the early morning hours. Umbrellas for rent on site.', 'Meno affollata nelle prime ore del mattino. Ombrelloni a noleggio sul posto.', 'Am Morgen weniger überlaufen. Sonnenschirme vor Ort mietbar.')
      },
      {
        hotel: HOTEL_SLUG, category: 'plazhe', name: 'Gjiri i Fshehur', price_type: 'free', staff_pick: false,
        lat: 39.7702, lng: 19.9868,
        meta: lt('Shkëmbor, ujë i thellë · 15 min në këmbë', 'Rocky, deep water · 15 min walk', 'Roccioso, acqua profonda · 15 min a piedi', 'Felsig, tiefes Wasser · 15 Min. zu Fuß'),
        tip: lt('Merrni këpucë uji. Nuk ka hije natyrale, çadër është e nevojshme.', 'Bring water shoes. No natural shade, an umbrella is a must.', "Portate scarpe da scoglio. Nessun'ombra naturale, l'ombrellone è indispensabile.", 'Bringen Sie Badeschuhe mit. Kein natürlicher Schatten, ein Schirm ist notwendig.')
      }
    ]);
    console.log('Seeded 6 example recommendations.');
  }

  await mongoose.disconnect();
  console.log('Done.');
}

seed().catch((err) => { console.error(err); process.exit(1); });
