# Platforma e Hoteleve — udhëzues i plotë

## E RËNDËSISHME: ndryshim strukturor i madh

Sistemi tani mbështet **shumë hotele njëkohësisht** në të njëjtin backend/bazë të
dhënash. Çdo hotel ka **slug-un e vet** (identifikues URL, p.sh. `bregu`,
`seaview`), dhe të dhënat e secilit janë krejtësisht të ndara nga hotelet e
tjera.

**Kjo do të thotë që çdo URL tani duhet ta ketë `?hotel=slug` (ose fushën
"Hoteli" në panelet).** Linqet e vjetra pa këtë parametër NUK funksionojnë më.

## Struktura

```
backend/
  server.js        → API multi-tenant + Socket.io + push + super-admin
  models.js         → skemat MongoDB, të gjitha me fushën `hotel`
  seed.js           → krijon një hotel shembull me përmbajtje: node seed.js bregu
  .env              → MONGODB_URI + fjalëkalime + VAPID + SUPER_ADMIN_PASSWORD
hotel-bregu-guest-app.html → app-i i mysafirit (kërkon ?hotel=slug&room=X)
staff-dashboard.html      → paneli i stafit (kërkon slug hoteli + fjalëkalim)
admin.html                 → paneli admin (kërkon slug hoteli + fjalëkalim)
super-admin.html            → KRIJO/FSHI hotele (fjalëkalim master i vetëm)
index.html                  → faqe hyrëse me lidhje te panelet
```

## Si të krijosh hotelin e parë

1. `cd backend && npm install` (do të shkarkojë çdo gjë, përfshi `web-push`)
2. `npm start` — duhet të shohësh "Connected to MongoDB" dhe "Hotel platform backend running..."
3. Hap `super-admin.html`, vendos URL-në e backend-it dhe `SUPER_ADMIN_PASSWORD` (te `.env`)
4. Plotëso formularin "Krijo hotel të ri": slug (p.sh. `bregu`), emri, fjalëkalim admin, fjalëkalim stafi
5. Kliko "Krijo hotelin" — tani ekziston në bazën e të dhënash, gati për t'u përdorur

**Alternativë e shpejtë për hotelin e parë:** `node seed.js bregu` e krijon
automatikisht hotelin `bregu` me përmbajtje shembull (wifi, pajisje,
rekomandime) — përdor fjalëkalimet nga `.env` (`ADMIN_PASSWORD`/`STAFF_PASSWORD`).

## Si duken URL-të tani

- **App i mysafirit:** `hotel-bregu-guest-app.html?hotel=bregu&room=214&floor=2`
- **Paneli i stafit:** hap `staff-dashboard.html`, plotëso "Hoteli" = `bregu`
- **Admin:** hap `admin.html`, plotëso "Hoteli" = `bregu`
- **Kodet QR** të gjeneruara te admin tani e përfshijnë vetë `&hotel=bregu` — s'ke nevojë ta shtosh dorazi

## Si të shtosh hotel të dytë, të tretë, etj.

Thjesht hap `super-admin.html` sërish dhe krijo një tjetër, me slug tjetër
(p.sh. `seaview`). Të dhënat e tij janë krejtësisht të ndara — stafi i
`bregu` s'i sheh kërkesat e `seaview`, e as anasjelltas.

## Fjalëkalimet (te backend/.env)

- `SUPER_ADMIN_PASSWORD` — **fjalëkalimi më i rëndësishëm**, jep akses për të
  krijuar/fshirë çdo hotel në platformë. Ndryshoje domosdoshmërisht përpara
  se ta vendosësh live.
- `ADMIN_PASSWORD` / `STAFF_PASSWORD` — përdoren VETËM nga `seed.js` si vlera
  fillestare kur krijon hotelin `bregu` me atë skript. Hotelet e krijuara nga
  `super-admin.html` marrin fjalëkalimet që vendos vetë në formular, jo këto.

## Hapat për ta vendosur (deploy)

1. Push në GitHub (`git add .`, `git commit`, `git push`)
2. Te Render → Web Service → Environment, shto **të gjitha** ndryshoret nga
   `.env` (përfshi `SUPER_ADMIN_PASSWORD`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`)
3. Pas rideploy-it, hap `super-admin.html` dhe krijo hotelin e parë (ose
   `node seed.js bregu` lokalisht, i lidhur me të njëjtin `MONGODB_URI`)

## Kufizime për t'i ditur

- URL-ja e çdo hoteli bazohet te `?hotel=slug`, jo subdomain apo path i
  veçantë — kjo është falas dhe funksionon menjëherë, por s'duket aq
  "profesionale" sa p.sh. `bregu.hotelet.com`. Nëse do subdomain të vërtetë,
  duhet domain i blerë + konfigurim DNS + plan i paguar në Render.
- Pastrimi ditor i mesazheve (11:00 Europe/Tirane) tani zbatohet për TË
  GJITHA hotelet njëkohësisht, jo secili me kohën e vet — mund të ndryshohet
  më vonë nëse duhet.
- S'ka ende faturim/limite përdorimi mes hoteleve — të gjithë ndajnë të
  njëjtin plan Render/MongoDB Atlas.
