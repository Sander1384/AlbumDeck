import "dotenv/config";
import axios from "axios";
import cors from "cors";
import crypto from "crypto";
import express from "express";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { getAlbum, getAlbums, getAllAlbums, getLyricsForSong, subsonicCoverUrl, subsonicStreamUrl, type NavidromeConfig } from "./navidrome.js";

const app = express();
const PORT = Number(process.env.APP_PORT ?? 8080);
const COVER_SIZE = Number(process.env.COVER_SIZE ?? 1200);
const ALBUM_BATCH_SIZE = Number(process.env.NAVIDROME_ALBUM_BATCH_SIZE ?? 500);
const MAX_ALBUMS = Number(process.env.NAVIDROME_MAX_ALBUMS ?? 20000);
const DATA_DIR = path.resolve(process.cwd(), ".data");
const CUSTOM_COVERS_FILE = path.join(DATA_DIR, "custom-disc-covers.json");
const AUTH_FILE = path.join(DATA_DIR, "auth.json");
const NAVIDROME_URL = process.env.NAVIDROME_URL?.trim() ?? "";
const NAVIDROME_USER = process.env.NAVIDROME_USER?.trim() ?? "";
const NAVIDROME_PASS = process.env.NAVIDROME_PASS?.trim() ?? "";
const NAVIDROME_CLIENT = process.env.NAVIDROME_CLIENT?.trim() || "albumdeck-app";
const NAVIDROME_ALLOW_INSECURE_TLS = (process.env.NAVIDROME_ALLOW_INSECURE_TLS ?? "false").toLowerCase() === "true";
const DISCOGS_TOKEN = process.env.DISCOGS_TOKEN?.trim() ?? "";
const DISCOGS_USER_AGENT = "AlbumDeck/0.3.0 +https://github.com/Sander1384/AlbumDeck";
const CAST_URL_TTL_SECONDS = Number(process.env.CAST_URL_TTL_SECONDS ?? 60 * 60 * 6);
const CAST_PUBLIC_URL = process.env.CAST_PUBLIC_URL?.trim().replace(/\/+$/, "") ?? "";
const CAST_TOKEN_SECRET =
  process.env.CAST_TOKEN_SECRET?.trim() ||
  crypto.createHash("sha256").update(`${NAVIDROME_URL}:${NAVIDROME_USER}:${NAVIDROME_PASS}`).digest("hex");
let customCoverWriteQueue: Promise<void> = Promise.resolve();
const activeSessions = new Set<string>();

if (!NAVIDROME_URL || !NAVIDROME_USER || !NAVIDROME_PASS) {
  throw new Error("Missing NAVIDROME_URL/NAVIDROME_USER/NAVIDROME_PASS in environment");
}

const navidromeConfig: NavidromeConfig = {
  navidromeUrl: NAVIDROME_URL.replace(/\/+$/, ""),
  navidromeUser: NAVIDROME_USER,
  navidromePass: NAVIDROME_PASS,
  appName: NAVIDROME_CLIENT,
  allowInsecureTls: NAVIDROME_ALLOW_INSECURE_TLS
};

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "8mb" }));

type AuthConfig = {
  username: string;
  passwordHash: string;
  salt: string;
};

function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const passwordHash = crypto.pbkdf2Sync(password, salt, 310000, 32, "sha256").toString("hex");
  return { salt, passwordHash };
}

function verifyPassword(password: string, auth: AuthConfig) {
  const candidate = Buffer.from(hashPassword(password, auth.salt).passwordHash, "hex");
  const stored = Buffer.from(auth.passwordHash, "hex");
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

async function readAuthConfig(): Promise<AuthConfig | null> {
  try {
    const raw = await fs.readFile(AUTH_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<AuthConfig>;
    if (!parsed.username || !parsed.passwordHash || !parsed.salt) return null;
    return {
      username: parsed.username,
      passwordHash: parsed.passwordHash,
      salt: parsed.salt
    };
  } catch {
    return null;
  }
}

async function writeAuthConfig(username: string, password: string) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const next = { username, ...hashPassword(password) };
  const tmp = `${AUTH_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tmp, AUTH_FILE);
  return next;
}

function parseCookies(header?: string): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, decodeURIComponent(rest.join("="))];
    }).filter(([key]) => Boolean(key))
  );
}

function sessionCookieOptions(req: express.Request) {
  const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";
  return `HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${isSecure ? "; Secure" : ""}`;
}

function createSession(res: express.Response, req: express.Request) {
  const token = crypto.randomBytes(32).toString("hex");
  activeSessions.add(token);
  res.setHeader("set-cookie", `albumdeck_session=${encodeURIComponent(token)}; ${sessionCookieOptions(req)}`);
}

function clearSession(res: express.Response) {
  res.setHeader("set-cookie", "albumdeck_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
}

function castSignature(songId: string, expires: number) {
  return crypto.createHmac("sha256", CAST_TOKEN_SECRET).update(`${songId}:${expires}`).digest("hex");
}

function timingSafeTextEqual(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createCastStreamPath(songId: string) {
  const expires = Math.floor(Date.now() / 1000) + CAST_URL_TTL_SECONDS;
  const signature = castSignature(songId, expires);
  return `/api/cast-stream/${encodeURIComponent(songId)}?expires=${expires}&sig=${signature}`;
}

function createCastStreamUrl(req: express.Request, songId: string) {
  const streamPath = createCastStreamPath(songId);
  return createPublicUrl(req, streamPath);
}

function createPublicUrl(req: express.Request, publicPath: string) {
  if (CAST_PUBLIC_URL) return new URL(publicPath, `${CAST_PUBLIC_URL}/`).toString();

  const proto = typeof req.headers["x-forwarded-proto"] === "string" ? req.headers["x-forwarded-proto"].split(",")[0].trim() : req.protocol;
  const host = typeof req.headers["x-forwarded-host"] === "string" ? req.headers["x-forwarded-host"].split(",")[0].trim() : req.get("host");
  if (!host) return publicPath;
  return `${proto}://${host}${publicPath}`;
}

function validateCastStreamRequest(req: express.Request) {
  const songId = String(req.params.songId);
  const expires = Number(req.query.expires);
  const signature = typeof req.query.sig === "string" ? req.query.sig : "";
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  return timingSafeTextEqual(signature, castSignature(songId, expires));
}

async function isAuthenticated(req: express.Request) {
  const auth = await readAuthConfig();
  if (!auth) return { configured: false, authenticated: false, username: undefined };
  const token = parseCookies(req.headers.cookie).albumdeck_session;
  return {
    configured: true,
    authenticated: Boolean(token && activeSessions.has(token)),
    username: auth.username
  };
}

async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const state = await isAuthenticated(req);
  if (!state.configured) {
    res.status(401).json({ error: "Setup required", setupRequired: true });
    return;
  }
  if (!state.authenticated) {
    res.status(401).json({ error: "Login required" });
    return;
  }
  next();
}

async function readCustomCovers(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(CUSTOM_COVERS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeCustomCovers(data: Record<string, unknown>): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${CUSTOM_COVERS_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, CUSTOM_COVERS_FILE);
}

async function updateCustomCovers(mutator: (covers: Record<string, unknown>) => void): Promise<Record<string, unknown>> {
  const run = customCoverWriteQueue.then(async () => {
    const covers = await readCustomCovers();
    mutator(covers);
    await writeCustomCovers(covers);
    return covers;
  });
  customCoverWriteQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function isCustomCoverPayload(cover: unknown): cover is Record<string, unknown> {
  if (!cover || typeof cover !== "object" || Array.isArray(cover)) return false;
  const candidate = cover as Record<string, unknown>;
  return typeof candidate.source === "string";
}

function discogsHeaders(accept = "application/json"): Record<string, string> {
  const headers: Record<string, string> = {
    accept,
    "user-agent": DISCOGS_USER_AGENT
  };
  if (DISCOGS_TOKEN) {
    headers.authorization = `Discogs token=${DISCOGS_TOKEN}`;
  }
  return headers;
}

function parseDiscogsPageUrl(rawUrl: string): { kind: "release" | "master"; id: string } | null {
  const target = new URL(rawUrl);
  if (!/(^|\.)discogs\.com$/i.test(target.hostname)) return null;

  const parts = target.pathname.split("/").filter(Boolean);
  const extractId = (segment?: string) => segment?.match(/^(\d+)/)?.[1];

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i].toLowerCase();
    const kind =
      part === "release" || part === "releases" ? "release" :
      part === "master" || part === "masters" ? "master" :
      null;

    if (!kind) continue;

    const id = extractId(parts[i + 1]) ?? extractId(parts[i - 1]);
    if (id) return { kind, id };
  }

  return null;
}

function cleanDiscogsImageUrl(url: string): string {
  return url.replace(/\\u002F/g, "/").replace(/&amp;/g, "&");
}

function compactDiscogsImages(images: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      images
        .filter((url): url is string => Boolean(url))
        .map(cleanDiscogsImageUrl)
        .filter((url) => /^https?:\/\/(?:i|img|api-img)\.discogs\.com\//i.test(url))
    )
  );
}

function extractDiscogsImagesFromHtml(html: string): string[] {
  const matches = new Set<string>();
  const add = (url: string) => matches.add(cleanDiscogsImageUrl(url));

  const directRe = /https?:\/\/(?:i|img|api-img)\.discogs\.com\/[^"'\\\s<>()]+/gi;
  let directMatch: RegExpExecArray | null;
  while ((directMatch = directRe.exec(html)) !== null) add(directMatch[0]);

  const jsonImageRe = /"(?:uri|resource_url|thumbnail|thumb|image)"\s*:\s*"(https?:\/\/(?:i|img|api-img)\.discogs\.com\/[^"]+)"/gi;
  let jsonMatch: RegExpExecArray | null;
  while ((jsonMatch = jsonImageRe.exec(html)) !== null) add(jsonMatch[1]);

  return Array.from(matches);
}

async function getDiscogsImagesFromApi(kind: "release" | "master", id: string): Promise<string[]> {
  const endpoint = kind === "release" ? "releases" : "masters";
  const response = await axios.get<{
    images?: Array<{ uri?: string; resource_url?: string; uri150?: string }>;
  }>(`https://api.discogs.com/${endpoint}/${id}`, {
    timeout: 20000,
    headers: discogsHeaders()
  });

  const images = response.data.images ?? [];
  return compactDiscogsImages(images.flatMap((img) => [img.uri, img.resource_url, img.uri150]));
}

async function getDiscogsImagesFromHtml(url: string): Promise<string[]> {
  const response = await axios.get<string>(url, {
    responseType: "text",
    timeout: 20000,
    headers: discogsHeaders("text/html,application/xhtml+xml")
  });

  const html = response.data;
  const matches = new Set(extractDiscogsImagesFromHtml(html));
  const imagePageLinks = new Set<string>();
  const pageRe = /href="(\/(?:master|release)\/[^\"]+\/image\/[^\"]+)"/gi;
  let pageMatch: RegExpExecArray | null;
  while ((pageMatch = pageRe.exec(html)) !== null) {
    const rel = pageMatch[1].split("?")[0];
    imagePageLinks.add(`https://www.discogs.com${rel}`);
  }

  const imagePages = Array.from(imagePageLinks).slice(0, 24);
  await Promise.all(
    imagePages.map(async (pageUrl) => {
      try {
        const page = await axios.get<string>(pageUrl, {
          responseType: "text",
          timeout: 20000,
          headers: discogsHeaders("text/html,application/xhtml+xml")
        });
        extractDiscogsImagesFromHtml(page.data).forEach((image) => matches.add(image));
      } catch {
        // ignore single page failure
      }
    })
  );

  return Array.from(matches);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/auth/status", async (req, res) => {
  const state = await isAuthenticated(req);
  res.json(state);
});

app.post("/api/auth/setup", async (req, res) => {
  try {
    const existing = await readAuthConfig();
    if (existing) {
      res.status(409).json({ error: "Admin user already exists" });
      return;
    }
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (username.length < 2 || password.length < 6) {
      res.status(400).json({ error: "Use at least 2 characters for the username and 6 for the password" });
      return;
    }
    const auth = await writeAuthConfig(username, password);
    createSession(res, req);
    res.json({ configured: true, authenticated: true, username: auth.username });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Setup failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const auth = await readAuthConfig();
    if (!auth) {
      res.status(409).json({ error: "Setup required", setupRequired: true });
      return;
    }
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (username !== auth.username || !verifyPassword(password, auth)) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }
    createSession(res, req);
    res.json({ configured: true, authenticated: true, username: auth.username });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Login failed" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  const token = parseCookies(req.headers.cookie).albumdeck_session;
  if (token) activeSessions.delete(token);
  clearSession(res);
  res.json({ ok: true });
});

app.put("/api/auth/admin", requireAuth, async (req, res) => {
  try {
    const auth = await readAuthConfig();
    if (!auth) {
      res.status(409).json({ error: "Setup required", setupRequired: true });
      return;
    }
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!verifyPassword(currentPassword, auth)) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }
    if (username.length < 2) {
      res.status(400).json({ error: "Use at least 2 characters for the username" });
      return;
    }
    if (password && password.length < 6) {
      res.status(400).json({ error: "Use at least 6 characters for the new password" });
      return;
    }
    const next = await writeAuthConfig(username, password || currentPassword);
    activeSessions.clear();
    createSession(res, req);
    res.json({ configured: true, authenticated: true, username: next.username });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not update admin" });
  }
});

async function handleCastStream(req: express.Request, res: express.Response) {
  if (!validateCastStreamRequest(req)) {
    res.status(403).json({ error: "Invalid or expired Cast stream URL" });
    return;
  }

  try {
    const streamUrl = subsonicStreamUrl(navidromeConfig, String(req.params.songId), { format: "mp3", maxBitRate: 320 });
    await pipeNavidromeStream(req, res, streamUrl, "audio/mpeg");
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Cast stream failed" });
  }
}

app.head("/api/cast-stream/:songId", handleCastStream);
app.get("/api/cast-stream/:songId", handleCastStream);

app.use("/api", requireAuth);

app.get("/api/albums", async (req, res) => {
  try {
    if (req.query.size !== undefined || req.query.offset !== undefined) {
      const size = Number(req.query.size ?? 50);
      const offset = Number(req.query.offset ?? 0);
      const albums = await getAlbums(navidromeConfig, size, offset);
      res.json({ albums, count: albums.length, offset, size });
      return;
    }

    const albums = await getAllAlbums(navidromeConfig, ALBUM_BATCH_SIZE, MAX_ALBUMS);
    res.json({ albums, count: albums.length });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/albums/:id", async (req, res) => {
  try {
    const album = await getAlbum(navidromeConfig, req.params.id);
    res.json(album);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/cover/:coverId", async (req, res) => {
  try {
    const querySize = Number(req.query.size);
    const size = Number.isFinite(querySize) && querySize > 0 ? Math.floor(querySize) : COVER_SIZE;
    const coverUrl = subsonicCoverUrl(navidromeConfig, req.params.coverId, size);
    const response = await axios.get<ArrayBuffer>(coverUrl, { responseType: "arraybuffer" });
    const contentTypeHeader = response.headers["content-type"];
    const contentType = typeof contentTypeHeader === "string" ? contentTypeHeader : "image/jpeg";
    res.setHeader("content-type", contentType);
    res.setHeader("cache-control", "public, max-age=300");
    res.send(Buffer.from(response.data));
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "Cover fetch failed" });
  }
});

app.get("/api/stream/:songId", async (req, res) => {
  try {
    const streamUrl = subsonicStreamUrl(navidromeConfig, req.params.songId);
    await pipeNavidromeStream(req, res, streamUrl);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Stream failed" });
  }
});

app.get("/api/lyrics/:songId", async (req, res) => {
  try {
    const artist = typeof req.query.artist === "string" ? req.query.artist : undefined;
    const title = typeof req.query.title === "string" ? req.query.title : undefined;
    const lyrics = await getLyricsForSong(navidromeConfig, { id: req.params.songId, artist, title });
    res.json(lyrics ?? { synced: false, lines: [] });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Lyrics fetch failed" });
  }
});

app.get("/api/cast-url/:songId", (req, res) => {
  res.json({ url: createCastStreamUrl(req, String(req.params.songId)), expiresIn: CAST_URL_TTL_SECONDS });
});

app.get("/api/cast-asset/:fileName", (req, res) => {
  const fileName = String(req.params.fileName);
  if (!["door.mp3", "draai.mp3"].includes(fileName)) {
    res.status(404).json({ error: "Unknown Cast asset" });
    return;
  }
  res.json({ url: createPublicUrl(req, `/${fileName}`) });
});

async function pipeNavidromeStream(
  req: express.Request,
  res: express.Response,
  streamUrl: string,
  fallbackContentType = "audio/mpeg"
) {
  const range = typeof req.headers.range === "string" ? req.headers.range : undefined;
  const response = await axios.get(streamUrl, {
    responseType: "stream",
    headers: range ? { range } : undefined,
    validateStatus: (status) => status >= 200 && status < 300
  });

  const contentTypeHeader = response.headers["content-type"];
  const contentType = typeof contentTypeHeader === "string" ? contentTypeHeader : fallbackContentType;
  const contentLength = response.headers["content-length"];
  const contentRange = response.headers["content-range"];
  const acceptRanges = response.headers["accept-ranges"];

  if (response.status === 206) {
    res.status(206);
  }
  res.setHeader("content-type", contentType);
  res.setHeader("accept-ranges", typeof acceptRanges === "string" ? acceptRanges : "bytes");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-expose-headers", "Accept-Ranges, Content-Length, Content-Range, Content-Type");
  if (typeof contentLength === "string") res.setHeader("content-length", contentLength);
  if (typeof contentRange === "string") res.setHeader("content-range", contentRange);
  res.setHeader("cache-control", "no-store");
  if (req.method === "HEAD") {
    response.data.destroy();
    res.end();
    return;
  }
  response.data.pipe(res);
}

app.get("/api/image-proxy", async (req, res) => {
  try {
    const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
    if (!rawUrl) {
      res.status(400).json({ error: "Missing url query param" });
      return;
    }

    const target = new URL(rawUrl);
    if (!["http:", "https:"].includes(target.protocol)) {
      res.status(400).json({ error: "Only http/https URLs are allowed" });
      return;
    }

    const response = await axios.get<ArrayBuffer>(target.toString(), {
      responseType: "arraybuffer",
      timeout: 20000,
      headers: { "user-agent": "AlbumDeck/1.0" }
    });

    const contentTypeHeader = response.headers["content-type"];
    const contentType = typeof contentTypeHeader === "string" ? contentTypeHeader : "image/jpeg";
    if (!contentType.startsWith("image/")) {
      res.status(415).json({ error: "URL did not return an image" });
      return;
    }

    res.setHeader("content-type", contentType);
    res.setHeader("cache-control", "public, max-age=86400");
    res.send(Buffer.from(response.data));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Image proxy failed" });
  }
});

app.get("/api/discogs-images", async (req, res) => {
  try {
    const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
    if (!rawUrl) {
      res.status(400).json({ error: "Missing url query param" });
      return;
    }

    const target = new URL(rawUrl);
    const host = target.hostname.toLowerCase();
    if (host === "i.discogs.com" || host === "img.discogs.com" || host === "api-img.discogs.com") {
      res.json({ images: [target.toString()] });
      return;
    }

    if (!/(^|\.)discogs\.com$/i.test(target.hostname)) {
      res.status(400).json({ error: "Only discogs.com URLs are allowed" });
      return;
    }

    const page = parseDiscogsPageUrl(target.toString());
    let images: string[] = [];
    if (page) {
      try {
        images = await getDiscogsImagesFromApi(page.kind, page.id);
      } catch {
        images = [];
      }
    }
    if (!images.length) {
      images = await getDiscogsImagesFromHtml(target.toString());
    }

    images = compactDiscogsImages(images).slice(0, 120);
    res.json({ images });
  } catch (error) {
    res.json({ images: [], warning: error instanceof Error ? error.message : "Discogs image lookup failed" });
  }
});

app.get("/api/discogs-search", async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) {
      res.status(400).json({ error: "Missing q query param" });
      return;
    }

    type DiscogsSearchResult = { title: string; artist?: string; url: string; images?: string[]; formats?: string[]; score: number; order: number };
    const results: DiscogsSearchResult[] = [];
    const seen = new Set<string>();
    let order = 0;

    const formatScore = (formats: string[]) => {
      const joined = formats.join(" ").toLowerCase();
      let score = 0;
      if (/\b(cd|cdr|cd-r|sacd|hdcd)\b/.test(joined)) score += 120;
      if (/enhanced|multimedia/.test(joined)) score += 12;
      if (/album/.test(joined)) score += 8;
      if (/\b(lp|vinyl|12\"|10\"|7\")\b/.test(joined)) score -= 90;
      if (/cassette|tape|reel/.test(joined)) score -= 55;
      if (/file|mp3|flac|aac|download/.test(joined)) score -= 45;
      if (/dvd|blu-ray|vhs/.test(joined)) score -= 35;
      if (/single|ep|promo|sampler/.test(joined)) score -= 12;
      return score;
    };

    const splitDiscogsTitle = (rawTitle: string) => {
      const cleaned = rawTitle.replace(/\s+/g, " ").trim();
      const parts = cleaned.split(/\s+-\s+/);
      if (parts.length < 2) return { title: cleaned };
      return {
        artist: parts[0].trim(),
        title: parts.slice(1).join(" - ").trim()
      };
    };

    const pushResult = (rawTitle: string, url: string, images?: string[], formats: string[] = []) => {
      const { artist, title } = splitDiscogsTitle(rawTitle);
      if (seen.has(url)) return;
      seen.add(url);
      results.push({ title, artist, url, images, formats, score: formatScore(formats), order: order++ });
    };

    const fetchDiscogsSearch = async (params: Record<string, string | number>) => {
      const response = await axios.get<{
        results?: Array<{ title?: string; uri?: string; type?: string; cover_image?: string; thumb?: string; format?: string[] }>;
      }>("https://api.discogs.com/database/search", {
        timeout: 20000,
        headers: discogsHeaders(),
        params
      });

      for (const item of response.data.results ?? []) {
        const rel = item.uri;
        const title = item.title?.replace(/\s+/g, " ").trim();
        if (!rel || !title) continue;
        const url = rel.startsWith("http") ? rel : `https://www.discogs.com${rel}`;
        pushResult(title, url, compactDiscogsImages([item.cover_image, item.thumb]), item.format ?? []);
      }
    };

    try {
      await fetchDiscogsSearch({ q, type: "release", format: "CD", per_page: 20, page: 1 });
      await fetchDiscogsSearch({ q, type: "release", per_page: 30, page: 1 });
    } catch {
      // Fall back to the public HTML page when the API is unavailable.
    }

    if (!results.length) {
      const searchUrl = `https://www.discogs.com/search/?q=${encodeURIComponent(q)}&type=all`;
      const response = await axios.get<string>(searchUrl, {
        responseType: "text",
        timeout: 20000,
        headers: discogsHeaders("text/html,application/xhtml+xml")
      });

      const html = response.data;
      const re = /href="(\/(?:master|release)\/[^\"]+)"[^>]*>([^<]+)</gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        const rel = m[1];
        const title = m[2].replace(/\s+/g, " ").trim();
        if (!title) continue;
        const url = `https://www.discogs.com${rel.split("?")[0]}`;
        pushResult(title, url);
        if (results.length >= 20) break;
      }
    }

    results.sort((a, b) => b.score - a.score || a.order - b.order);
    res.json({ results: results.slice(0, 30).map(({ score: _score, order: _order, ...result }) => result) });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Discogs search failed" });
  }
});

app.get("/api/custom-disc-covers", async (_req, res) => {
  try {
    await customCoverWriteQueue;
    const covers = await readCustomCovers();
    res.json({ covers });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to read covers" });
  }
});

app.put("/api/custom-disc-covers", async (req, res) => {
  try {
    const covers = req.body?.covers;
    if (!covers || typeof covers !== "object" || Array.isArray(covers)) {
      res.status(400).json({ error: "Invalid covers payload" });
      return;
    }
    await updateCustomCovers((existing) => {
      Object.assign(existing, covers);
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save covers" });
  }
});

app.put("/api/custom-disc-covers/:albumId", async (req, res) => {
  try {
    const albumId = req.params.albumId?.trim();
    const cover = req.body?.cover;
    if (!albumId || !isCustomCoverPayload(cover)) {
      res.status(400).json({ error: "Invalid cover payload" });
      return;
    }
    await updateCustomCovers((covers) => {
      covers[albumId] = cover;
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save cover" });
  }
});

app.delete("/api/custom-disc-covers/:albumId", async (req, res) => {
  try {
    const albumId = req.params.albumId?.trim();
    if (!albumId) {
      res.status(400).json({ error: "Invalid album id" });
      return;
    }
    await updateCustomCovers((covers) => {
      delete covers[albumId];
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to delete cover" });
  }
});

const STATIC_DIR = path.resolve(process.cwd(), "public");
const STATIC_INDEX = path.join(STATIC_DIR, "index.html");
if (fsSync.existsSync(STATIC_INDEX)) {
  app.use(express.static(STATIC_DIR));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(STATIC_INDEX);
  });
}

app.listen(PORT, () => {
  console.log(`AlbumDeck backend listening on :${PORT}`);
});
