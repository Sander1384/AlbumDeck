# Navidrome CD Player Tablet App

## Doel

Een tablet-webapp die eruitziet als een moderne CD-speler:

- Links: grote vierkante albumcover
- Rechts: draaiende CD/cirkel met dezelfde album art subtiel op de disc
- Onder: gele tijdlijn/progress bar van het huidige nummer
- Boven: blauw menu om terug te gaan naar albums, artists, playlists of queue
- Audio komt uit Navidrome
- Album art komt eerst uit Navidrome
- Als fallback kan MusicBrainz / Cover Art Archive worden gebruikt
- Later eventueel als Android APK via Capacitor

---

## Beste aanpak

### Fase 1: Webapp / PWA

We maken eerst een gewone webapp:

- Werkt op tablet, pc en telefoon
- Kan fullscreen op Android
- Makkelijk hosten via CasaOS / Docker / Nginx
- Geen Play Store of APK nodig
- Later eenvoudig om te zetten naar APK

Aanbevolen stack:

- Vite
- React
- TypeScript
- CSS animations
- Navidrome/Subsonic API
- Optioneel: service worker voor PWA/fullscreen install

---

## Waarom geen native APK als eerste stap?

Een APK kan later, maar voor de eerste versie is een webapp slimmer:

1. Sneller bouwen
2. Makkelijker debuggen
3. Werkt direct op je tablet
4. Past goed bij je bestaande CasaOS/Navidrome setup
5. Geen gedoe met Android Studio in het begin

Later kunnen we dezelfde app wrappen met Capacitor:

```bash
npm install @capacitor/core @capacitor/cli
npx cap init
npx cap add android
```

---

## Bronnen voor metadata en covers

### 1. Primaire bron: Navidrome

Navidrome heeft zelf meestal al:

- Albumlijst
- Artistlijst
- Songlijst
- Cover art
- Audio stream
- Play/pause/status via Subsonic-compatible endpoints

Voordeel:

- Snel
- Lokaal
- Geen externe API-key nodig
- Past bij je bestaande muziekcollectie

### 2. Fallback: MusicBrainz + Cover Art Archive

Als Navidrome geen cover heeft:

1. Zoek album + artist bij MusicBrainz
2. Pak de MusicBrainz Release ID / MBID
3. Haal cover op via Cover Art Archive
4. Cache de afbeelding lokaal

Voorbeeldlogica:

```txt
Navidrome cover aanwezig?
  ja -> gebruik Navidrome cover
  nee -> zoek MusicBrainz release
        -> cover ophalen via Cover Art Archive
        -> lokaal cachen
```

### 3. Discogs als latere optie

Discogs is interessant, maar minder geschikt als eerste fallback omdat:

- Authenticatie/API-token nodig is
- Image access strenger is
- Matching soms rommeliger is bij meerdere releases/persingen

Conclusie:

```txt
MVP:
Navidrome cover art

Versie 2:
MusicBrainz + Cover Art Archive fallback

Versie 3:
Discogs fallback
```

---

## Globaal ontwerp

```txt
┌──────────────────────────────────────────────┐
│ blauw menu: Albums | Artists | Playlists     │
├───────────────────────┬──────────────────────┤
│                       │                      │
│   album cover          │   draaiende CD       │
│   vierkant             │   met cover texture  │
│                       │                      │
├───────────────────────┴──────────────────────┤
│ titel - artiest                              │
│ gele voortgangsbalk                          │
│ 00:42 ---------------------------- 03:21     │
└──────────────────────────────────────────────┘
```

---

## App-functionaliteit

### MVP

De eerste versie moet dit kunnen:

- Verbinden met Navidrome
- Inloggen met server URL, username en password/token
- Albums tonen
- Album selecteren
- Tracks tonen
- Track afspelen
- Albumcover tonen
- Draaiende CD tonen tijdens afspelen
- Tijdlijn tonen
- Play/pause/next/previous
- Tabletvriendelijke layout

### Versie 2

Daarna uitbreiden met:

- Now playing scherm
- Queue
- Shuffle/repeat
- Zoekfunctie
- MusicBrainz cover fallback
- Lokale cover-cache
- PWA install mode
- Fullscreen/kiosk mode

### Versie 3

Later:

- APK via Capacitor
- Android tablet autostart
- Landscape-only mode
- Screensaver mode
- Grote afstandsbediening-knoppen
- WebSocket/polling voor live update
- Integratie met Last.fm/ListenBrainz/Navidrome scrobbles

---

## Navidrome API concept

Navidrome ondersteunt Subsonic-compatible API-routes.

Basisvorm:

```txt
https://music.noxar.nl/rest/ENDPOINT.view
```

Veelgebruikte parameters:

```txt
u=username
p=password_or_token
v=1.16.1
c=cd-player-app
f=json
```

Voorbeeld endpoints die we waarschijnlijk nodig hebben:

```txt
/rest/getAlbumList2.view
/rest/getAlbum.view
/rest/stream.view
/rest/getCoverArt.view
/rest/search3.view
/rest/getPlaylists.view
/rest/getPlaylist.view
```

Voor audio:

```txt
/rest/stream.view?id=SONG_ID&u=USER&p=PASS&v=1.16.1&c=cd-player-app
```

Voor cover art:

```txt
/rest/getCoverArt.view?id=COVER_ID&u=USER&p=PASS&v=1.16.1&c=cd-player-app
```

---

## Belangrijk: veiligheid

Niet ideaal:

```txt
Navidrome username/password hardcoded in frontend
```

Beter:

```txt
Frontend -> kleine backend proxy -> Navidrome
```

Waarom?

- Je login komt dan niet zichtbaar in de browsercode
- Je kunt covers cachen
- Je kunt MusicBrainz fallback netjes afhandelen
- Je kunt later makkelijk Discogs-token veilig opslaan

Aanbevolen architectuur:

```txt
Tablet browser
   ↓
CD Player Webapp
   ↓
Node/Express proxy
   ↓
Navidrome API
   ↓
Music library
```

---

## Projectstructuur

```txt
navidrome-cd-player/
├── README.md
├── docker-compose.yml
├── .env
├── backend/
│   ├── package.json
│   ├── src/
│   │   ├── server.ts
│   │   ├── navidrome.ts
│   │   ├── coverFallback.ts
│   │   └── cache.ts
│   └── Dockerfile
├── frontend/
│   ├── package.json
│   ├── index.html
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api.ts
│   │   ├── components/
│   │   │   ├── CdPlayer.tsx
│   │   │   ├── SpinningDisc.tsx
│   │   │   ├── AlbumCover.tsx
│   │   │   ├── Timeline.tsx
│   │   │   ├── TopMenu.tsx
│   │   │   └── AlbumBrowser.tsx
│   │   ├── styles/
│   │   │   └── player.css
│   │   └── main.tsx
│   └── Dockerfile
└── data/
    └── cover-cache/
```

---

## .env voorbeeld

```env
NAVIDROME_URL=https://music.noxar.nl
NAVIDROME_USER=jouw_gebruiker
NAVIDROME_PASS=jouw_wachtwoord_of_token

APP_PORT=8877

MUSICBRAINZ_USER_AGENT=NavidromeCDPlayer/0.1 (sander1384@gmail.com)
```

---

## Docker Compose concept

```yaml
services:
  navidrome-cd-player:
    build: .
    container_name: navidrome-cd-player
    ports:
      - "8877:8877"
    env_file:
      - .env
    volumes:
      - ./data/cover-cache:/app/data/cover-cache
    restart: unless-stopped
```

---

## Frontend design

### Kleuren gebaseerd op jouw schets

```css
:root {
  --menu-blue: #168be8;
  --cover-red: #e51616;
  --disc-green: #55b947;
  --timeline-yellow: #f3df18;
  --background: #f5f5f2;
  --text: #111;
}
```

### Layout

```css
.player-screen {
  width: 100vw;
  height: 100vh;
  background: var(--background);
  display: grid;
  grid-template-rows: 64px 1fr 90px;
}

.top-menu {
  height: 64px;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 28px;
  border-bottom: 4px dashed var(--menu-blue);
}

.player-main {
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  padding: 32px 48px;
}

.album-cover {
  width: min(42vw, 420px);
  aspect-ratio: 1 / 1;
  border: 5px solid var(--cover-red);
  object-fit: cover;
}

.disc {
  width: min(38vw, 390px);
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  border: 5px solid var(--disc-green);
  background-size: cover;
  background-position: center;
  animation: spinDisc 1.2s linear infinite;
}

.disc.paused {
  animation-play-state: paused;
}

@keyframes spinDisc {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.timeline {
  height: 90px;
  padding: 0 48px;
}

.progress-track {
  height: 6px;
  background: #ddd;
}

.progress-fill {
  height: 6px;
  background: var(--timeline-yellow);
  width: 0%;
}
```

---

## Draaiende CD met albumcover

De disc kan de albumcover als achtergrond gebruiken, maar met een donkere/transparante overlay zodat het echt als een CD voelt.

Concept:

```css
.disc {
  position: relative;
  border-radius: 50%;
  overflow: hidden;
  background-image: var(--cover-url);
  background-size: cover;
  background-position: center;
}

.disc::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background:
    radial-gradient(circle at center, #f5f5f5 0 8%, transparent 9%),
    radial-gradient(circle at center, transparent 0 28%, rgba(255,255,255,0.35) 29% 31%, transparent 32%),
    radial-gradient(circle at center, rgba(0,0,0,0.15), rgba(255,255,255,0.25));
}

.disc::after {
  content: "";
  position: absolute;
  inset: 45%;
  background: #f5f5f5;
  border-radius: 50%;
}
```

---

## Backend endpoints voor onze app

Onze eigen backend maakt simpele endpoints voor de frontend.

```txt
GET /api/albums
GET /api/albums/:id
GET /api/cover/:coverId
GET /api/stream/:songId
GET /api/search?q=...
GET /api/fallback-cover?artist=...&album=...
```

Frontend hoeft dan niet direct met Navidrome-login te werken.

---

## Audio-afspelen

In React gebruiken we een gewone HTML audio player zonder standaard UI.

```tsx
<audio
  ref={audioRef}
  src={`/api/stream/${currentTrack.id}`}
  onTimeUpdate={updateProgress}
  onEnded={playNext}
/>
```

De knoppen sturen de audio aan:

```txt
Play -> audio.play()
Pause -> audio.pause()
Next -> volgende track in queue
Previous -> vorige track
Seek -> audio.currentTime = gekozen positie
```

---

## MusicBrainz fallback logic

Pseudo-code:

```txt
function findFallbackCover(artist, album):
  search MusicBrainz release:
    artist + album

  if release found:
    get MBID

  call:
    https://coverartarchive.org/release/{MBID}

  select image where:
    front = true

  cache image locally

  return cached image URL
```

Belangrijk:

- MusicBrainz netjes gebruiken met User-Agent
- Niet spammen
- Covers lokaal cachen

---

## Tabletmodus

Op Android tablet:

1. Open Chrome
2. Ga naar de app-url, bijvoorbeeld:

```txt
http://192.168.1.60:8877
```

3. Kies:

```txt
Toevoegen aan startscherm
```

4. Open vanaf startscherm
5. Eventueel fullscreen/kiosk app gebruiken

Later kunnen we Android autostart instellen.

---

## Mogelijke URL's voor jouw setup

Lokaal:

```txt
http://192.168.1.60:8877
```

Via Cloudflare:

```txt
https://cdplayer.noxar.nl
```

Navidrome blijft bijvoorbeeld:

```txt
https://music.noxar.nl
```

---

## MVP bouwvolgorde

### Stap 1: Project aanmaken

```bash
mkdir navidrome-cd-player
cd navidrome-cd-player
```

### Stap 2: Frontend maken

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
```

### Stap 3: Eerste statische CD-speler layout maken

Doel:

- Cover links
- Draaiende disc rechts
- Timeline onder
- Menu boven

Nog zonder Navidrome.

### Stap 4: Backend proxy maken

```bash
mkdir backend
cd backend
npm init -y
npm install express cors dotenv axios
npm install -D typescript ts-node-dev @types/express @types/cors
```

### Stap 5: Navidrome verbinden

Backend leest:

```txt
NAVIDROME_URL
NAVIDROME_USER
NAVIDROME_PASS
```

Daarna bouwen we:

```txt
/api/albums
/api/albums/:id
/api/cover/:coverId
/api/stream/:songId
```

### Stap 6: Albums tonen

Frontend toont een simpele albumgrid.

Klik op album:

```txt
open album detail
toon tracks
klik track
start player
```

### Stap 7: Player werkend maken

- Track streamen
- Cover tonen
- Disc draait als audio speelt
- Disc pauzeert als audio pauzeert
- Timeline loopt mee

### Stap 8: MusicBrainz fallback

Pas toevoegen als Navidrome-cover niet bestaat.

### Stap 9: Docker maken

Doel:

```txt
1 container of 2 containers
draait op CasaOS
poort 8877
```

### Stap 10: Tablet testen

Test op:

```txt
http://192.168.1.60:8877
```

Daarna eventueel via Cloudflare.

---

## Eerste versie hoeft nog niet perfect te zijn

De eerste werkende versie moet vooral dit doen:

```txt
Album kiezen -> nummer speelt -> cover zichtbaar -> CD draait -> timeline loopt
```

Daarna maken we hem mooi.

---

## Openstaande keuzes

Nog kiezen:

- Wil je landscape-only?
- Wil je alleen eigen Navidrome library of ook losse zoekfunctie?
- Wil je fysieke CD-speler look, bijvoorbeeld Philips/Marantz/Denon-stijl?
- Wil je zwarte hifi-look of lichte schets-look zoals je afbeelding?
- Wil je touchknoppen groot en simpel voor tablet?
- Wil je autoplay naar volgende track?
- Wil je queue of gewoon album-volgorde?

---

## Aanbevolen eerste stijl

Voor jouw tablet zou ik starten met:

```txt
Landscape layout
Lichte achtergrond
Grote albumcover links
Realistische draaiende CD rechts
Grote gele progress bar
Bovenin simpele blauwe navigatie
Onderin grote knoppen:
Previous / Play-Pause / Next
```

Daarna kunnen we hem een echte hifi-look geven:

```txt
zwarte glasplaat
aluminium knoppen
groene displaytekst
VU-meter
CD-lade animatie
```

---

## Projectnaam ideeën

- NoxaDisc
- Navidrome CD Deck
- Noxar CD Player
- SpinDrome
- AlbumDeck
- DiscFlow

---

## Aanbevolen eerste opdracht voor de bouw

Maak eerst alleen de statische PWA-layout met nepdata:

- `frontend/src/App.tsx`
- `frontend/src/styles/player.css`
- nep-cover via `/public/demo-cover.jpg`
- disc draait continu
- play/pause knop pauzeert alleen de animatie
- tijdlijn gebruikt nep-progress

Daarna pas Navidrome koppelen.

Dit voorkomt dat we tegelijk UI, API, streaming en cover lookup moeten debuggen.
