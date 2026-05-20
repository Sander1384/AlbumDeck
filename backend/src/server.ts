import "dotenv/config";
import axios from "axios";
import cors from "cors";
import express from "express";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { getAlbum, getAlbums, getAllAlbums, subsonicCoverUrl, subsonicStreamUrl, type NavidromeConfig } from "./navidrome.js";

const app = express();
const PORT = Number(process.env.APP_PORT ?? 8080);
const COVER_SIZE = Number(process.env.COVER_SIZE ?? 1200);
const ALBUM_BATCH_SIZE = Number(process.env.NAVIDROME_ALBUM_BATCH_SIZE ?? 500);
const MAX_ALBUMS = Number(process.env.NAVIDROME_MAX_ALBUMS ?? 20000);
const DATA_DIR = path.resolve(process.cwd(), ".data");
const CUSTOM_COVERS_FILE = path.join(DATA_DIR, "custom-disc-covers.json");
const NAVIDROME_URL = process.env.NAVIDROME_URL?.trim() ?? "";
const NAVIDROME_USER = process.env.NAVIDROME_USER?.trim() ?? "";
const NAVIDROME_PASS = process.env.NAVIDROME_PASS?.trim() ?? "";
const NAVIDROME_CLIENT = process.env.NAVIDROME_CLIENT?.trim() || "albumdeck-app";
const NAVIDROME_ALLOW_INSECURE_TLS = (process.env.NAVIDROME_ALLOW_INSECURE_TLS ?? "false").toLowerCase() === "true";
const DISCOGS_TOKEN = process.env.DISCOGS_TOKEN?.trim() ?? "";
const DISCOGS_USER_AGENT = "AlbumDeck/0.3.0 +https://github.com/Sander1384/AlbumDeck";
let customCoverWriteQueue: Promise<void> = Promise.resolve();

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

app.use(cors());
app.use(express.json({ limit: "8mb" }));

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
    const response = await axios.get(streamUrl, {
      responseType: "stream"
    });

    const contentTypeHeader = response.headers["content-type"];
    const contentType = typeof contentTypeHeader === "string" ? contentTypeHeader : "audio/mpeg";
    res.setHeader("content-type", contentType);
    response.data.pipe(res);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Stream failed" });
  }
});

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
      headers: { "user-agent": "navidrome-cd-player/1.0" }
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

    const results: Array<{ title: string; url: string; images?: string[] }> = [];
    const seen = new Set<string>();

    try {
      const response = await axios.get<{
        results?: Array<{ title?: string; uri?: string; type?: string; cover_image?: string; thumb?: string }>;
      }>("https://api.discogs.com/database/search", {
        timeout: 20000,
        headers: discogsHeaders(),
        params: { q, type: "release", per_page: 20, page: 1 }
      });

      for (const item of response.data.results ?? []) {
        const rel = item.uri;
        const title = item.title?.replace(/\s+/g, " ").trim();
        if (!rel || !title) continue;
        const url = rel.startsWith("http") ? rel : `https://www.discogs.com${rel}`;
        if (seen.has(url)) continue;
        seen.add(url);
        results.push({ title, url, images: compactDiscogsImages([item.cover_image, item.thumb]) });
      }
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
        if (seen.has(url)) continue;
        seen.add(url);
        results.push({ title, url });
        if (results.length >= 20) break;
      }
    }

    res.json({ results });
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
  console.log(`Navidrome CD backend listening on :${PORT}`);
});
