#!/usr/bin/env node
// Adds a starter set of Sarandë recommendations (restaurants, bars, beaches)
// to the hotels you list. Put this file in the BACKEND folder (next to
// models.js and .env) and run:
//
//   node seed-saranda.js --hotels seaview,daylux          (dry run: shows what it would add)
//   node seed-saranda.js --hotels seaview,daylux --yes    (actually adds them)
//   add --no-geocode to skip the map-pin lookup
//
// - Map pins are looked up from OpenStreetMap (Nominatim, free) while it runs.
//   Places it can't find are added WITHOUT a pin — the card still shows, just
//   no marker on the map. Check the pins in admin and fix any that look wrong.
// - A place whose name already exists in that hotel is skipped, so running it
//   twice does not create duplicates.
// - Everything can be edited or deleted afterwards from admin.html.
// - The descriptions come from public travel guides; prices, hours and
//   whether a place is still open can change — review before guests rely on it.

require('dotenv').config();
const mongoose = require('mongoose');
const { Recommendation, Hotel } = require('./models');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
const HOTELS = String(arg('hotels', '')).toLowerCase().split(',').map((h) => h.trim()).filter(Boolean);
const YES = process.argv.includes('--yes');
const GEOCODE = !process.argv.includes('--no-geocode');
if (!HOTELS.length) { console.error('Pass --hotels seaview,daylux'); process.exit(1); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI missing — run this from the backend folder that has your .env.'); process.exit(1); }

const t = (sq, en, it, de, fr) => ({ sq, en, it, de, fr });

// geo = search text for the map pin
const PLACES = [
  // ---------- RESTORANTE ----------
  { category: 'restorante', name: 'Limani', geo: 'Limani restaurant', price_type: 'mid',
    meta: t('Mish, pica, makarona dhe sallata · në qendër, buzë ujit', 'Meat, pizza, pasta and salads · in the centre, on the water', 'Carne, pizza, pasta e insalate · in centro, sull\'acqua', 'Fleisch, Pizza, Pasta und Salate · im Zentrum, am Wasser', 'Viandes, pizzas, pâtes et salades · au centre, au bord de l\'eau'),
    tip: t('Menu e gjerë për çdo shije, me çmime të arsyeshme.', 'A wide menu for every taste at reasonable prices.', 'Menu ampio per tutti i gusti a prezzi ragionevoli.', 'Große Karte für jeden Geschmack zu fairen Preisen.', 'Un grand choix pour tous les goûts à prix raisonnables.') },
  { category: 'restorante', name: 'Te Bequa', geo: 'Te Bequa restaurant', price_type: 'mid', staff_pick: true,
    meta: t('Ushqim tradicional shqiptar i bërë në shtëpi · në qendër', 'Homemade traditional Albanian food · in the centre', 'Cucina tradizionale albanese casalinga · in centro', 'Hausgemachte traditionelle albanische Küche · im Zentrum', 'Cuisine albanaise traditionnelle maison · au centre'),
    tip: t('Pranë parkut të miqësisë. Çmime vendase.', 'Next to the friendship park. Local prices.', 'Vicino al parco dell\'amicizia. Prezzi locali.', 'Neben dem Freundschaftspark. Einheimische Preise.', 'À côté du parc de l\'amitié. Prix locaux.') },
  { category: 'restorante', name: 'Fishland', geo: 'Fishland restaurant', price_type: 'mid',
    meta: t('Peshk i freskët direkt nga barka · te porti i peshkimit', 'Seafood fresh from the boat · at the fishing port', 'Pesce fresco direttamente dalla barca · al porto dei pescatori', 'Fangfrischer Fisch direkt vom Boot · am Fischereihafen', 'Poisson frais du bateau · au port de pêche'),
    tip: t('Rreth 30 minuta në këmbë nga qendra — merrni taksi nëse nxehet.', 'About a 30-minute walk from the centre — take a taxi if it is hot.', 'Circa 30 minuti a piedi dal centro — prendete un taxi se fa caldo.', 'Etwa 30 Gehminuten vom Zentrum — bei Hitze besser ein Taxi nehmen.', 'Environ 30 minutes à pied du centre — prenez un taxi s\'il fait chaud.') },
  { category: 'restorante', name: 'Taverna Kapiteni', geo: 'Taverna Kapiteni', price_type: 'mid',
    meta: t('Fruta deti vendase, kallamar dhe rizoto · pranë stadiumit', 'Local seafood, calamari and risotto · next to the stadium', 'Pesce locale, calamari e risotto · vicino allo stadio', 'Lokale Meeresfrüchte, Calamari und Risotto · neben dem Stadion', 'Fruits de mer locaux, calamars et risotto · près du stade'),
    tip: t('Zgjedhje e mirë për peshk dhe fruta deti.', 'A good pick for fish and seafood.', 'Ottima scelta per pesce e frutti di mare.', 'Eine gute Wahl für Fisch und Meeresfrüchte.', 'Un bon choix pour le poisson et les fruits de mer.') },
  { category: 'restorante', name: 'Paradise', geo: 'Paradise restaurant', price_type: 'mid',
    meta: t('Fruta deti dhe karkaleca saganaki · në fund të bulevardit, buzë ujit', 'Seafood and shrimp saganaki · end of the boulevard, on the water', 'Frutti di mare e gamberi saganaki · in fondo al lungomare, sull\'acqua', 'Meeresfrüchte und Garnelen-Saganaki · am Ende der Promenade, am Wasser', 'Fruits de mer et crevettes saganaki · au bout du boulevard, au bord de l\'eau'),
    tip: t('Provoni karkalecat saganaki.', 'Try the shrimp saganaki.', 'Provate i gamberi saganaki.', 'Probieren Sie die Garnelen-Saganaki.', 'Goûtez les crevettes saganaki.') },
  { category: 'restorante', name: 'Balbi 34', geo: 'Balbi 34', price_type: 'mid',
    meta: t('Makarona të bëra me dorë, pjata italiane dhe verëra', 'Handmade pasta, Italian dishes and wines', 'Pasta fatta a mano, piatti italiani e vini', 'Handgemachte Pasta, italienische Gerichte und Weine', 'Pâtes faites main, plats italiens et vins'),
    tip: t('Cilësi e mirë për çmimin.', 'Good quality for the price.', 'Buona qualità per il prezzo.', 'Gute Qualität für den Preis.', 'Bonne qualité pour le prix.') },
  { category: 'restorante', name: 'Taverna Garden', geo: 'Taverna Garden', price_type: 'mid',
    meta: t('Ushqim autentik shqiptar, çorbë peshku · në bulevard', 'Authentic Albanian food, fish soup · on the boulevard', 'Cucina albanese autentica, zuppa di pesce · sul lungomare', 'Authentische albanische Küche, Fischsuppe · an der Promenade', 'Cuisine albanaise authentique, soupe de poisson · sur le boulevard'),
    tip: t('Çmime të përballueshme.', 'Affordable prices.', 'Prezzi accessibili.', 'Erschwingliche Preise.', 'Prix abordables.') },

  // ---------- BARE ----------
  { category: 'bare', name: 'Jericho', geo: 'Jericho cocktail bar', price_type: 'mid', staff_pick: true,
    meta: t('Koktej, kafe dhe çaj · në bulevardin e ri', 'Cocktails, coffee and tea · on the new boulevard', 'Cocktail, caffè e tè · sul nuovo lungomare', 'Cocktails, Kaffee und Tee · an der neuen Promenade', 'Cocktails, café et thé · sur le nouveau boulevard'),
    tip: t('Shpesh ka happy hour mes 18:00 dhe 20:00 në bare të ngjashme — pyesni.', 'Bars like this often run happy hour between 6 and 8 pm — ask.', 'Bar come questo spesso fanno happy hour tra le 18 e le 20 — chiedete.', 'Bars wie dieses haben oft Happy Hour zwischen 18 und 20 Uhr — fragen Sie nach.', 'Les bars de ce type proposent souvent un happy hour entre 18 h et 20 h — demandez.') },
  { category: 'bare', name: 'Hou Nalu', geo: 'Hou Nalu bar', price_type: 'mid',
    meta: t('Koktej origjinalë dhe DJ vendas çdo javë', 'Unusual cocktails and local DJs every week', 'Cocktail originali e DJ locali ogni settimana', 'Besondere Cocktails und jede Woche lokale DJs', 'Cocktails originaux et DJ locaux chaque semaine'),
    tip: t('Pranë Nomad Burgers & Steak.', 'Right by Nomad Burgers & Steak.', 'Vicino a Nomad Burgers & Steak.', 'Direkt bei Nomad Burgers & Steak.', 'Juste à côté de Nomad Burgers & Steak.') },
  { category: 'bare', name: 'Jungle Rooftop Lounge', geo: 'Jungle Rooftop Lounge', price_type: 'mid',
    meta: t('Lounge në tarracë · afër bregdetit', 'Rooftop lounge · near the promenade', 'Rooftop lounge · vicino al lungomare', 'Rooftop-Lounge · nahe der Promenade', 'Lounge sur le toit · près de la promenade'),
    tip: t('Vlerësim i lartë nga vizitorët (4.7 në Google).', 'Highly rated by visitors (4.7 on Google).', 'Molto apprezzato dai visitatori (4,7 su Google).', 'Bei Besuchern hoch bewertet (4,7 auf Google).', 'Très bien noté par les visiteurs (4,7 sur Google).') },
  { category: 'bare', name: 'Julia Rooftop Lounge & Restaurant', geo: 'Julia Rooftop Lounge', price_type: 'mid',
    meta: t('Lounge dhe restorant në tarracë', 'Rooftop lounge and restaurant', 'Rooftop lounge e ristorante', 'Rooftop-Lounge und Restaurant', 'Lounge et restaurant sur le toit'),
    tip: t('Vlerësim i lartë nga vizitorët (4.8 në Google).', 'Highly rated by visitors (4.8 on Google).', 'Molto apprezzato dai visitatori (4,8 su Google).', 'Bei Besuchern hoch bewertet (4,8 auf Google).', 'Très bien noté par les visiteurs (4,8 sur Google).') },
  { category: 'bare', name: 'Lost Seaside', geo: 'Lost Seaside beach club', price_type: 'high',
    meta: t('Beach club nga dita në natë, me pishinë dhe shezlongë', 'Day-to-night beach club with a pool and daybeds', 'Beach club dal giorno alla notte, con piscina e lettini', 'Beachclub von Tag bis Nacht, mit Pool und Daybeds', 'Beach club du jour à la nuit, avec piscine et lits de jour'),
    tip: t('Rreth 1.5 km nga bulevardi — merrni taksi.', 'About 1.5 km from the promenade — take a taxi.', 'A circa 1,5 km dal lungomare — prendete un taxi.', 'Etwa 1,5 km von der Promenade — am besten per Taxi.', 'À environ 1,5 km de la promenade — prenez un taxi.') },
  { category: 'bare', name: 'Elvis Bar', geo: 'Elvis Bar', price_type: 'mid',
    meta: t('Bar i vogël pranë bulevardit', 'Small bar close to the promenade', 'Piccolo bar vicino al lungomare', 'Kleine Bar nahe der Promenade', 'Petit bar près de la promenade'),
    tip: t('Vlerësim i lartë nga vizitorët (4.8 në Google). Bare të vogla shpesh pranojnë vetëm para në dorë.', 'Highly rated by visitors (4.8 on Google). Small bars often take cash only.', 'Molto apprezzato dai visitatori (4,8 su Google). I bar piccoli spesso accettano solo contanti.', 'Bei Besuchern hoch bewertet (4,8 auf Google). Kleine Bars nehmen oft nur Bargeld.', 'Très bien noté par les visiteurs (4,8 sur Google). Les petits bars n\'acceptent souvent que les espèces.') },

  // ---------- PLAZHE ----------
  { category: 'plazhe', name: 'Plazhi i Qytetit', geo: 'Sarandë city beach', price_type: 'free',
    meta: t('Zhavorr · në qytet, buzë bulevardit', 'Gravel · in town, along the promenade', 'Ghiaia · in città, lungo il lungomare', 'Kies · in der Stadt, an der Promenade', 'Galets · en ville, le long de la promenade'),
    tip: t('I përshtatshëm për një not të shpejtë pa dalë nga qyteti.', 'Handy for a quick swim without leaving town.', 'Comodo per un tuffo veloce senza lasciare la città.', 'Praktisch für ein schnelles Bad, ohne die Stadt zu verlassen.', 'Pratique pour une baignade rapide sans quitter la ville.') },
  { category: 'plazhe', name: 'Gjiri i Midhjeve', geo: 'Gjiri i Midhjeve', price_type: 'mid',
    meta: t('Zhavorr · në jug të Sarandës', 'Pebble · south end of Sarandë', 'Ciottoli · a sud di Saranda', 'Kiesel · südlich von Saranda', 'Galets · au sud de Saranda'),
    tip: t('Plazh privat me shezlongë me pagesë; në sezon rreth 2000 lekë për dy shezlongë dhe çadër. Çmimet ndryshojnë.', 'Private beach with paid loungers; around 2,000 lek for two loungers and a parasol in season. Prices vary.', 'Spiaggia privata con lettini a pagamento; circa 2.000 lek per due lettini e ombrellone in stagione. I prezzi variano.', 'Privatstrand mit kostenpflichtigen Liegen; in der Saison ca. 2.000 Lek für zwei Liegen und Schirm. Preise schwanken.', 'Plage privée avec transats payants ; environ 2 000 lek pour deux transats et un parasol en saison. Les prix varient.') },
  { category: 'plazhe', name: 'Plazhi i Pasqyrave', geo: 'Mirror Beach Plazhi i Pasqyrave', price_type: 'mid', staff_pick: true,
    meta: t('Guralecë · e vogël dhe më e qetë, midis Sarandës dhe Ksamilit', 'Pebble · small and quieter, between Sarandë and Ksamil', 'Ciottoli · piccola e più tranquilla, tra Saranda e Ksamil', 'Kiesel · klein und ruhiger, zwischen Saranda und Ksamil', 'Galets · petite et plus calme, entre Saranda et Ksamil'),
    tip: t('Ka bar plazhi, restorant dhe shezlongë me qira. Dallgët mund të jenë më të forta kur ka erë.', 'Has a beach bar, restaurant and sunbed hire. Waves can be stronger when it is windy.', 'Ha beach bar, ristorante e noleggio lettini. Le onde possono essere più forti col vento.', 'Mit Strandbar, Restaurant und Liegenverleih. Bei Wind kann der Wellengang stärker sein.', 'Beach bar, restaurant et location de transats. Les vagues peuvent être plus fortes par vent.') },
  { category: 'plazhe', name: 'Pulëbardha', geo: 'Pulebardha beach', price_type: 'free',
    meta: t('Bregdet shkëmbor · gjysmë rruge midis Sarandës dhe Ksamilit', 'Rocky coast · halfway between Sarandë and Ksamil', 'Costa rocciosa · a metà strada tra Saranda e Ksamil', 'Felsige Küste · auf halbem Weg zwischen Saranda und Ksamil', 'Côte rocheuse · à mi-chemin entre Saranda et Ksamil'),
    tip: t('Shkoni herët në sezon — pas orës 11:00 parkimi bëhet i vështirë. Vetëm për të rritur.', 'Go early in season — parking gets hard after 11 am. Adults only.', 'Andate presto in stagione — dopo le 11 il parcheggio è difficile. Solo adulti.', 'In der Saison früh kommen — nach 11 Uhr wird das Parken schwierig. Nur für Erwachsene.', 'Venez tôt en saison — après 11 h le stationnement devient difficile. Réservé aux adultes.') },
  { category: 'plazhe', name: 'Gjiri i Hartës', geo: 'Gjiri i Hartes', price_type: 'free',
    meta: t('I mbrojtur nga dallgët · midis Sarandës dhe Ksamilit', 'Sheltered from swell · between Sarandë and Ksamil', 'Riparata dalle onde · tra Saranda e Ksamil', 'Wellengeschützt · zwischen Saranda und Ksamil', 'Abritée de la houle · entre Saranda et Ksamil'),
    tip: t('Mirë për familje — deti mbetet i qetë edhe kur ka erë.', 'Good for families — the sea stays calm even in wind.', 'Ottima per famiglie — il mare resta calmo anche col vento.', 'Gut für Familien — das Meer bleibt auch bei Wind ruhig.', 'Idéale pour les familles — la mer reste calme même par vent.') },
  { category: 'plazhe', name: 'Plazhi i Ksamilit', geo: 'Ksamil beach', price_type: 'mid', staff_pick: true,
    meta: t('Rërë e bardhë, pa dallgë', 'White sand, hardly any waves', 'Sabbia bianca, quasi senza onde', 'Weißer Sand, kaum Wellen', 'Sable blanc, presque sans vagues'),
    tip: t('Shumë i frekuentuar në verë: shkoni herët ose rezervoni shezlongun një ditë më parë. Parkimi me pagesë mbushet shpejt.', 'Very popular in summer: go early or reserve a sunbed the day before. Paid parking fills up fast.', 'Molto frequentata d\'estate: andate presto o prenotate il lettino il giorno prima. Il parcheggio a pagamento si riempie in fretta.', 'Im Sommer sehr beliebt: früh kommen oder die Liege am Vortag reservieren. Der kostenpflichtige Parkplatz ist schnell voll.', 'Très fréquentée en été : venez tôt ou réservez un transat la veille. Le parking payant se remplit vite.') }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocode(q) {
  // Bounding box around Sarandë – Ksamil so a same-named place elsewhere isn't picked.
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&bounded=1&viewbox=19.95,39.95,20.15,39.70&q=' +
    encodeURIComponent(q + ', Albania');
  const res = await fetch(url, { headers: { 'User-Agent': 'hotel-bregu-seed/1.0 (hotel guest app)' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if (!j.length) return null;
  return { lat: Number(j[0].lat), lng: Number(j[0].lon) };
}

(async () => {
  // Look up pins once (same places for every hotel).
  const pins = {};
  if (GEOCODE) {
    console.log('Looking up map pins on OpenStreetMap (about 1 second each)...');
    for (const p of PLACES) {
      try { pins[p.name] = await geocode(p.geo); } catch (e) { pins[p.name] = null; }
      console.log(`  ${pins[p.name] ? 'pin ' : 'none'}  ${p.name}${pins[p.name] ? `  (${pins[p.name].lat.toFixed(4)}, ${pins[p.name].lng.toFixed(4)})` : ''}`);
      await sleep(1100);
    }
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`\nDatabase: ${mongoose.connection.name}   mode: ${YES ? 'ADD' : 'dry run'}\n`);

  for (const slug of HOTELS) {
    if (!(await Hotel.findOne({ slug }))) { console.log(`${slug}: hotel not found — skipped.`); continue; }
    const existing = new Set((await Recommendation.find({ hotel: slug }, 'name').lean()).map((r) => r.name.toLowerCase()));
    let added = 0, skipped = 0;
    for (const p of PLACES) {
      if (existing.has(p.name.toLowerCase())) { skipped++; continue; }
      const doc = { hotel: slug, category: p.category, name: p.name, price_type: p.price_type, staff_pick: !!p.staff_pick, meta: p.meta, tip: p.tip };
      if (pins[p.name]) { doc.lat = pins[p.name].lat; doc.lng = pins[p.name].lng; }
      if (YES) await Recommendation.create(doc);
      added++;
    }
    console.log(`${slug}: ${added} ${YES ? 'added' : 'would be added'}, ${skipped} already there (skipped).`);
  }
  if (!YES) console.log('\nNothing was added. Add --yes to apply.');
  else console.log('\nDone. Open admin → Rekomandime to review the pins, edit or delete anything.');
  await mongoose.disconnect();
})().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
