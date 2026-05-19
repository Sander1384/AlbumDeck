# AlbumDeck

A tactile CD-style web player for Navidrome, with spinning disc visuals, Discogs-based custom disc cover mapping, and Docker-first deployment.

## Features

- Navidrome albums + tracks via backend proxy
- CD-tray style animation with load sounds
- Custom disc cover editor per album (upload, URL, Discogs lookup)
- Persisted disc mappings (survive refresh/restart)
- A-Z artist filter in CD rack menu
- Dark mode + Light mode
- Responsive layout for tablet, desktop, laptop, TV, and mobile browsers

## Device support

AlbumDeck is not tablet-only.  
It is a responsive web app and scales automatically based on screen size.

Tested target classes:

- Tablets (Lenovo M10 and similar)
- Laptops/desktops
- Large monitors / TVs (browser or kiosk mode)
- Mobile phones

## Quick start (Docker)

### 1) Configure environment

Copy `.env.example` to `.env` and fill in:

- `NAVIDROME_URL`
- `NAVIDROME_USER`
- `NAVIDROME_PASS`
- optional: `NAVIDROME_ALLOW_INSECURE_TLS=true` for self-signed certs

### 2) Start

Windows:

- Double-click `start-docker.bat`

Or terminal:

```bash
docker compose up -d --build
```

### 3) Open

- Local PC: `http://localhost:8080`
- Tablet on same network: `http://<YOUR-PC-IP>:8080`

Find your IP with:

```powershell
ipconfig
```

### 4) Stop

```bash
docker compose down
```

## Persistent data

Custom disc cover mappings are stored in Docker volume:

- `backend_data` mounted at `/app/.data`

So CD mappings remain after refresh/restart/redeploy.

## Local dev (optional)

Backend:

```bash
cd backend
npm install
npm run dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Troubleshooting

### `unable to get local issuer certificate`

Set in `.env`:

```env
NAVIDROME_ALLOW_INSECURE_TLS=true
```

### Port already in use

- Backend: `8877`
- Frontend Docker: `8080`

Change host ports in `docker-compose.yml` if needed.

### Covers not saving

Check backend container can write to `/app/.data` and volume `backend_data` exists.

## Privacy note

No private credentials are committed in this repo.  
Use `.env` locally or in your deployment secret manager.

## Roadmap

- First-run web setup/login screen
- One-click Discogs image candidate scoring
- Kiosk profile presets (tablet/TV)
- Optional multi-user profile storage
