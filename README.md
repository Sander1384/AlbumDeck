# AlbumDeck

AlbumDeck is a kiosk-friendly CD-style web player for Navidrome. It shows a large album sleeve and spinning CD, can store custom CD artwork, and ships as a single Docker container.

[![Release](https://img.shields.io/github/v/release/Sander1384/AlbumDeck?label=release)](https://github.com/Sander1384/AlbumDeck/releases/latest)
[![Docker build](https://img.shields.io/github/actions/workflow/status/Sander1384/AlbumDeck/docker-publish.yml?branch=main&label=docker%20build)](https://github.com/Sander1384/AlbumDeck/actions/workflows/docker-publish.yml)
[![GHCR](https://img.shields.io/badge/GHCR-albumdeck-blue)](https://github.com/Sander1384/AlbumDeck/pkgs/container/albumdeck)

## Features

- Browse and play albums from Navidrome through the Subsonic API.
- Large tablet/kiosk layout with album sleeve, CD visual, vertical controls, fullscreen button, and seek bar.
- Adjustable visual CD spin speed. The empty CD stays still; loading animation and loading sound keep their own timing.
- Optional Discogs search for custom CD and sleeve-back artwork.
- Persistent custom artwork in `/app/.data/custom-disc-covers.json`.
- Optional Google Cast sender support in Chrome/Chromium over HTTPS.

## Quick Start

1. Copy `.env.example` to `.env`.
2. Fill in your Navidrome settings:

```env
NAVIDROME_URL=https://music.example.com
NAVIDROME_USER=your_user
NAVIDROME_PASS=your_navidrome_credential
```

3. Start the prebuilt image:

```bash
docker compose -f docker-compose.ghcr.yml up -d
```

4. Open AlbumDeck:

```text
http://localhost:8080
```

## Portainer / NAS

Use [`docker-compose.portainer.yml`](./docker-compose.portainer.yml) as a starting point.

Before deploying, set:

- `NAVIDROME_URL`
- `NAVIDROME_USER`
- `NAVIDROME_PASS`
- A persistent volume for `/app/.data`

The Portainer example is pinned to:

```text
ghcr.io/sander1384/albumdeck:v0.3.23
```

After deploying, open:

```text
http://<NAS-IP>:8080
```

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NAVIDROME_URL` | yes | - | Base URL of your Navidrome server. |
| `NAVIDROME_USER` | yes | - | Navidrome username. |
| `NAVIDROME_PASS` | yes | - | Navidrome password or token. |
| `NAVIDROME_CLIENT` | no | `albumdeck-app` | Client name sent to Navidrome. |
| `NAVIDROME_ALLOW_INSECURE_TLS` | no | `false` | Set to `true` for self-signed Navidrome certificates. |
| `NAVIDROME_ALBUM_BATCH_SIZE` | no | `500` | Album page size when loading the library. |
| `NAVIDROME_MAX_ALBUMS` | no | `20000` | Safety cap for full library loading. |
| `DISCOGS_TOKEN` | no | empty | Optional Discogs token for more reliable search/image lookup. |
| `APP_PORT` | no | `8080` | Port inside the container. |

## Persistent Data

AlbumDeck writes custom CD cover mappings to:

```text
/app/.data/custom-disc-covers.json
```

Mount `/app/.data` to a Docker volume or NAS folder if you want custom covers to survive updates.

## Chromecast

Google Cast support depends on the browser and network:

- Use Chrome or Chromium.
- Open AlbumDeck via HTTPS.
- Use a hostname or IP address that your Chromecast can reach.
- Do not cast from `localhost`; the Chromecast device cannot load your computer's localhost.

## Local Development

Install dependencies once:

```bash
cd backend
npm install
cd ../frontend
npm install
```

Run both development servers:

```bash
start-dev.bat
```

Or build the single Docker image locally:

```bash
docker compose up -d --build
```

## Releases

This repository publishes Docker images to:

```text
ghcr.io/sander1384/albumdeck
```

Tags:

- `latest` and `main` are published from the `main` branch.
- `vX.Y.Z` tags publish versioned images.
- The compose examples are pinned to `v0.3.23` so new deployments do not accidentally pull an older cached image.

## Privacy Notes

AlbumDeck does not require secrets in the frontend build. Keep credentials in `.env`, Portainer environment variables, or your Docker secret management. Do not commit `.env` or `.data`.

The backend hashes Navidrome credentials for Subsonic API calls and proxies streams/covers server-side. Custom artwork mappings may contain external image URLs or data URLs, so treat `/app/.data` as personal library metadata.

## Troubleshooting

### No albums or missing albums

Check that `NAVIDROME_URL`, `NAVIDROME_USER`, and `NAVIDROME_PASS` are correct. For large libraries, raise `NAVIDROME_MAX_ALBUMS`.

### Discogs image lookup fails

Set `DISCOGS_TOKEN` if Discogs rate limits anonymous requests.

### Custom covers disappear after updates

Verify that `/app/.data` is mounted persistently. Without a volume, Docker will lose stored custom cover mappings when the container is replaced.

### Cast button is unavailable

Use Chrome/Chromium over HTTPS and make sure the Chromecast can reach the same URL.

### TLS certificate error

For self-signed Navidrome servers, set:

```env
NAVIDROME_ALLOW_INSECURE_TLS=true
```
