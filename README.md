# AlbumDeck

A tactile CD-style web player for Navidrome, with spinning disc visuals, Discogs-based custom disc cover mapping, and Docker-first deployment.

[![Release](https://img.shields.io/github/v/release/Sander1384/AlbumDeck?label=release)](https://github.com/Sander1384/AlbumDeck/releases/latest)
[![Docker build](https://img.shields.io/github/actions/workflow/status/Sander1384/AlbumDeck/docker-publish.yml?branch=main&label=docker%20build)](https://github.com/Sander1384/AlbumDeck/actions/workflows/docker-publish.yml)
[![GHCR](https://img.shields.io/badge/GHCR-albumdeck-blue)](https://github.com/Sander1384/AlbumDeck/pkgs/container/albumdeck)

## One Package Architecture

AlbumDeck is now shipped as one Docker image:
- `ghcr.io/sander1384/albumdeck`

Inside that container:
- Node backend serves the `/api/*` endpoints
- The compiled frontend is served from the same process on `/`

So you only deploy one container and one port.

## Quick Start (Prebuilt Image)

1. Create `.env` from `.env.example`.
2. Fill at least:
- `NAVIDROME_URL`
- `NAVIDROME_USER`
- `NAVIDROME_PASS`

3. Start:

```bash
docker compose -f docker-compose.ghcr.yml up -d
```

4. Open:
- `http://localhost:8080`

Stop:

```bash
docker compose -f docker-compose.ghcr.yml down
```

## Portainer / NAS Install

Use [`docker-compose.portainer.yml`](./docker-compose.portainer.yml).

Edit before deploy:
- `NAVIDROME_URL`
- `NAVIDROME_USER`
- `NAVIDROME_PASS`
- Volume path, for example: `/volume1/docker/albumdeck/backend-data:/app/.data`

Deploy via:
- Portainer -> Stacks -> Add stack -> Web editor

Then open:
- `http://<NAS-IP>:8080`

By default this stack is pinned to `v0.3.6`.
If you prefer rolling updates, change image tag to `latest`.

## Local Build Mode

```bash
docker compose up -d --build
```

This builds the unified root [`Dockerfile`](./Dockerfile).

## Releases and Tags

- Push to `main` publishes:
- `ghcr.io/sander1384/albumdeck:latest`
- `ghcr.io/sander1384/albumdeck:main`
- `ghcr.io/sander1384/albumdeck:sha-*`

- Git tag `vX.Y.Z` publishes:
- `ghcr.io/sander1384/albumdeck:vX.Y.Z`

Release flow:

```bash
git tag v0.3.6
git push origin v0.3.6
```

## Release Checklist (Important)

Before sharing the repo publicly, verify:
- GitHub Actions run succeeded for `docker-publish.yml`
- Container exists at `ghcr.io/sander1384/albumdeck`
- GitHub package visibility is set to `Public`
- `docker-compose.portainer.yml` references a real published tag
- `README.md` links point to the current package/release

## Persistent Data

CD cover mappings are stored at:
- `/app/.data`

Mount this path to keep data across updates.

## Troubleshooting

### Discogs search or image lookup fails

AlbumDeck can use Discogs without credentials, but a personal token makes Discogs search and image lookup more reliable.
Set `DISCOGS_TOKEN` in your environment or Portainer stack.

### Chromecast button cannot connect

Use Chrome/Chromium and open AlbumDeck through HTTPS on a hostname your Chromecast can reach.
Google Cast Web Sender does not reliably initialize from `http://<NAS-IP>:8080`.
Do not cast from `localhost`, because the Chromecast will try to load that URL on itself.

### TLS certificate error

Set in `.env`:

```env
NAVIDROME_ALLOW_INSECURE_TLS=true
```

### Port already in use

Default container port is `8080`.
Change the host-side port mapping in compose if needed.

## Links

- [Latest release](https://github.com/Sander1384/AlbumDeck/releases/latest)
- [Container image](https://github.com/Sander1384/AlbumDeck/pkgs/container/albumdeck)
- [Docker publish workflow](https://github.com/Sander1384/AlbumDeck/actions/workflows/docker-publish.yml)
