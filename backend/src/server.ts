import "dotenv/config";
import axios from "axios";
import cors from "cors";
import express from "express";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { getAlbum, getAlbums, subsonicCoverUrl, subsonicStreamUrl, type NavidromeConfig } from "./navidrome.js";

const app = express();
const PORT = Number(process.env.APP_PORT ?? 8877);
const COVER_SIZE = Number(process.env.COVER_SIZE ?? 1200);
const DATA_DIR = path.resolve(process.cwd(), ".data");
const CUSTOM_COVERS_FILE = path.join(DATA_DIR, "custom-disc-covers.json");
const NAVIDROME_URL = process.env.NAVIDROME_URL?.trim() ?? "";
const NAVIDROME_USER = process.env.NAVIDROME_USER?.trim() ?? "";
const NAVIDROME_PASS = process.env.NAVIDROME_PASS?.trim() ?? "";
const NAVIDROME_CLIENT = process.env.NAVIDROME_CLIENT?.trim() || "cd-player-app";
const NAVIDROME_ALLOW_INSECURE_TLS = (process.env.NAVIDROME_ALLOW_INSECURE_TLS ?? "false").toLowerCase() === "true";

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
  await fs.writeFile(CUSTOM_COVERS_FILE, JSON.stringify(data, null, 2), "utf8");
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/albums", async (req, res) => {
  try {
    const size = Number(req.query.size ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const albums = await getAlbums(navidromeConfig, size, offset);
    res.json({ albums });
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
    if (!target.hostname.toLowerCase().includes("discogs.com")) {
      res.status(400).json({ error: "Only discogs.com URLs are allowed" });
      return;
    }

    const response = await axios.get<string>(target.toString(), {
      responseType: "text",
      timeout: 20000,
      headers: { "user-agent": "navidrome-cd-player/1.0" }
    });

    const html = response.data;
    const matches = new Set<string>();

    const addImageMatches = (input: string) => {
      const re = /https?:\/\/(?:i|img)\.discogs\.com\/[^"'\\\s<>()]+/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(input)) !== null) {
        const candidate = m[0].replace(/\\u002F/g, "/").replace(/&amp;/g, "&");
        matches.add(candidate);
      }
    };

    addImageMatches(html);

    const imagePageLinks = new Set<string>();
    const pageRe = /href="(\/(?:master|release)\/[^\"]+\/image\/[^\"]+)"/gi;
    let pageMatch: RegExpExecArray | null;
    while ((pageMatch = pageRe.exec(html)) !== null) {
      const rel = pageMatch[1].split("?")[0];
      imagePageLinks.add(`https://www.discogs.com${rel}`);
    }

    const imagePages = Array.from(imagePageLinks).slice(0, 60);
    await Promise.all(
      imagePages.map(async (pageUrl) => {
        try {
          const page = await axios.get<string>(pageUrl, {
            responseType: "text",
            timeout: 20000,
            headers: { "user-agent": "navidrome-cd-player/1.0" }
          });
          addImageMatches(page.data);
        } catch {
          // ignore single page failure
        }
      })
    );

    const images = Array.from(matches).slice(0, 120);
    res.json({ images });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Discogs image lookup failed" });
  }
});

app.get("/api/discogs-search", async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) {
      res.status(400).json({ error: "Missing q query param" });
      return;
    }

    const searchUrl = `https://www.discogs.com/search/?q=${encodeURIComponent(q)}&type=all`;
    const response = await axios.get<string>(searchUrl, {
      responseType: "text",
      timeout: 20000,
      headers: { "user-agent": "navidrome-cd-player/1.0" }
    });

    const html = response.data;
    const results: Array<{ title: string; url: string }> = [];
    const seen = new Set<string>();
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

    res.json({ results });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Discogs search failed" });
  }
});

app.get("/api/custom-disc-covers", async (_req, res) => {
  try {
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
    await writeCustomCovers(covers as Record<string, unknown>);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save covers" });
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
