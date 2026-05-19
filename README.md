# Navidrome CD Player

## 1. `.env` instellen

Kopieer `.env.example` naar `.env` en vul:

- `NAVIDROME_URL`
- `NAVIDROME_USER`
- `NAVIDROME_PASS`
- optioneel: `NAVIDROME_ALLOW_INSECURE_TLS=true` (alleen als je certificaatfouten hebt)

## 2. Starten met Docker

Optie A:

- dubbelklik `start-docker.bat`

Optie B:

- `docker compose up -d --build`

## 3. Openen

- Op je PC: `http://localhost:8080`
- Op je Lenovo tablet (zelfde wifi): `http://<IP-VAN-JE-PC>:8080`

Tip: vind je IP met `ipconfig` (IPv4 Address).

## 4. Data die bewaard blijft

- Custom CD covers + mappings blijven bewaard in Docker volume `backend_data` (`/app/.data` in backend container).

## 5. Stoppen

- `docker compose down`
