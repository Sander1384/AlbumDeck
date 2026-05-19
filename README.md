# AlbumDeck

A tactile CD-style web player for Navidrome, with spinning disc visuals, Discogs-based custom disc cover mapping, and Docker-first deployment.

[![Release](https://img.shields.io/github/v/release/Sander1384/AlbumDeck?label=release)](https://github.com/Sander1384/AlbumDeck/releases/latest)
[![Docker build](https://img.shields.io/github/actions/workflow/status/Sander1384/AlbumDeck/docker-publish.yml?branch=main&label=docker%20build)](https://github.com/Sander1384/AlbumDeck/actions/workflows/docker-publish.yml)
[![GHCR Backend](https://img.shields.io/badge/GHCR-albumdeck--backend-blue)](https://github.com/Sander1384/AlbumDeck/pkgs/container/albumdeck-backend)
[![GHCR Frontend](https://img.shields.io/badge/GHCR-albumdeck--frontend-blue)](https://github.com/Sander1384/AlbumDeck/pkgs/container/albumdeck-frontend)

## What You Get

- Responsive frontend (tablet, desktop, TV, mobile)
- Backend proxy for Navidrome API
- Persisted custom CD mappings in Docker volume
- Portainer-ready stack file
- Automated Docker image publishing to GHCR on `main` and tags

## Quick Start (Pull Images, No Local Build)

1. Create `.env` from `.env.example`.
2. Fill at least:
- `NAVIDROME_URL`
- `NAVIDROME_USER`
- `NAVIDROME_PASS`

3. Start with prebuilt images:

```bash
docker compose -f docker-compose.ghcr.yml up -d
```

4. Open:
- Frontend: `http://localhost:8080`
- Backend health/path base: `http://localhost:8877/api`

Stop:

```bash
docker compose -f docker-compose.ghcr.yml down
```

## Portainer / NAS Install

Use [`docker-compose.portainer.yml`](./docker-compose.portainer.yml) as your stack template.

Edit before deploy:
- `NAVIDROME_URL`
- `NAVIDROME_USER`
- `NAVIDROME_PASS`
- volume path (example now: `/volume1/docker/albumdeck/backend-data:/app/.data`)

Deploy via:
- Portainer -> Stacks -> Add stack -> Web editor

After deploy:
- Open `http://<NAS-IP>:8080`

## Local Build Mode (Developer)

If you want local image builds instead of GHCR pulls:

```bash
docker compose up -d --build
```

This uses [`docker-compose.yml`](./docker-compose.yml).

## Releases and Tags

- `main` push publishes:
- `ghcr.io/sander1384/albumdeck-backend:latest`
- `ghcr.io/sander1384/albumdeck-frontend:latest`
- plus `main` and `sha-*` tags

- Git tag `vX.Y.Z` publishes:
- `ghcr.io/sander1384/albumdeck-backend:vX.Y.Z`
- `ghcr.io/sander1384/albumdeck-frontend:vX.Y.Z`

Create a release flow:

```bash
git tag v0.2.0
git push origin v0.2.0
```

Then publish the GitHub Release page at:
- `https://github.com/Sander1384/AlbumDeck/releases/new`

## Persistent Data

CD cover mappings are stored in Docker volume/path mounted to:
- `/app/.data` in backend container

## Troubleshooting

### TLS certificate error (`unable to get local issuer certificate`)

Set in `.env`:

```env
NAVIDROME_ALLOW_INSECURE_TLS=true
```

### Port already in use

Default ports:
- Frontend: `8080`
- Backend: `8877`

Change host-side ports in compose files if needed.

## Links

- [Latest release](https://github.com/Sander1384/AlbumDeck/releases/latest)
- [Backend image](https://github.com/Sander1384/AlbumDeck/pkgs/container/albumdeck-backend)
- [Frontend image](https://github.com/Sander1384/AlbumDeck/pkgs/container/albumdeck-frontend)
- [Docker publish workflow](https://github.com/Sander1384/AlbumDeck/actions/workflows/docker-publish.yml)
