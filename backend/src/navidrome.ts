import axios from "axios";
import crypto from "crypto";
import https from "https";

export type Song = {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  coverArt?: string;
};

export type Album = {
  id: string;
  name: string;
  artist?: string;
  year?: number;
  coverArt?: string;
  songCount?: number;
};

export type NavidromeConfig = {
  navidromeUrl: string;
  navidromeUser: string;
  navidromePass: string;
  appName?: string;
  allowInsecureTls?: boolean;
};

export type LyricLine = {
  start?: number;
  text: string;
};

export type SongLyrics = {
  synced: boolean;
  source?: string;
  lines: LyricLine[];
};

const API_VERSION = "1.16.1";

function authParams(cfg: NavidromeConfig) {
  const salt = crypto.randomBytes(4).toString("hex");
  const token = crypto.createHash("md5").update(`${cfg.navidromePass}${salt}`).digest("hex");

  return {
    u: cfg.navidromeUser,
    t: token,
    s: salt,
    v: API_VERSION,
    c: cfg.appName ?? "cd-player-app",
    f: "json"
  };
}

async function callSubsonic<T>(cfg: NavidromeConfig, endpoint: string, params: Record<string, string | number>) {
  const response = await axios.get<{ "subsonic-response": T & { status: string; error?: { code: number; message: string } } }>(
    `${cfg.navidromeUrl}/rest/${endpoint}.view`,
    {
      httpsAgent: cfg.allowInsecureTls ? new https.Agent({ rejectUnauthorized: false }) : undefined,
      params: {
        ...params,
        ...authParams(cfg)
      }
    }
  );

  const payload = response.data["subsonic-response"];

  if (payload.status !== "ok") {
    const message = payload.error?.message ?? "Navidrome request failed";
    throw new Error(message);
  }

  return payload;
}

export async function getAlbums(cfg: NavidromeConfig, size = 50, offset = 0): Promise<Album[]> {
  const data = await callSubsonic<{ albumList2?: { album?: Album[] } }>(cfg, "getAlbumList2", {
    type: "newest",
    size,
    offset
  });

  return data.albumList2?.album ?? [];
}

export async function getAllAlbums(cfg: NavidromeConfig, batchSize = 500, maxAlbums = 20000): Promise<Album[]> {
  const albums: Album[] = [];
  const seen = new Set<string>();
  let offset = 0;

  while (offset < maxAlbums) {
    const page = await getAlbums(cfg, batchSize, offset);
    if (!page.length) break;

    for (const album of page) {
      if (seen.has(album.id)) continue;
      seen.add(album.id);
      albums.push(album);
    }

    if (page.length < batchSize) break;
    offset += batchSize;
  }

  return albums;
}

export async function getAlbum(cfg: NavidromeConfig, id: string): Promise<{ album: Album & { song?: Song[] } }> {
  const data = await callSubsonic<{ album?: Album & { song?: Song[] } }>(cfg, "getAlbum", { id });

  if (!data.album) {
    throw new Error("Album not found");
  }

  return { album: data.album };
}

function normalizeLyricLine(line: unknown): LyricLine | null {
  if (typeof line === "string") {
    const text = line.trim();
    return text ? { text } : null;
  }
  if (!line || typeof line !== "object") return null;
  const candidate = line as Record<string, unknown>;
  const text = String(candidate.value ?? candidate.text ?? "").trim();
  if (!text) return null;
  const rawStart = candidate.start ?? candidate.startTime ?? candidate.time;
  const start = Number(rawStart);
  return Number.isFinite(start) ? { start: start / 1000, text } : { text };
}

function normalizeLyricsPayload(payload: unknown): SongLyrics | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const lyricsList = data.lyricsList as Record<string, unknown> | undefined;
  const structuredRaw = lyricsList?.structuredLyrics;
  const structured = Array.isArray(structuredRaw) ? structuredRaw[0] : structuredRaw;
  if (structured && typeof structured === "object") {
    const entry = structured as Record<string, unknown>;
    const lines = (Array.isArray(entry.line) ? entry.line : []).map(normalizeLyricLine).filter((line): line is LyricLine => Boolean(line));
    if (lines.length) {
      return { synced: lines.some((line) => Number.isFinite(line.start)), source: "navidrome", lines };
    }
  }

  const lyrics = data.lyrics as Record<string, unknown> | undefined;
  const value = typeof lyrics?.value === "string" ? lyrics.value : typeof data.value === "string" ? data.value : "";
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((text) => ({ text }));
  return lines.length ? { synced: false, source: "navidrome", lines } : null;
}

function parseLrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const timeRe = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  raw.split(/\r?\n/).forEach((row) => {
    const text = row.replace(timeRe, "").trim();
    if (!text) return;
    let match: RegExpExecArray | null;
    timeRe.lastIndex = 0;
    while ((match = timeRe.exec(row)) !== null) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = Number((match[3] ?? "0").padEnd(3, "0"));
      if (Number.isFinite(minutes) && Number.isFinite(seconds) && Number.isFinite(fraction)) {
        lines.push({ start: minutes * 60 + seconds + fraction / 1000, text });
      }
    }
  });

  return lines.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}

async function getLrclibLyrics(song: { artist?: string; title?: string; album?: string; duration?: number }): Promise<SongLyrics | null> {
  const artist = song.artist?.trim();
  const title = song.title?.trim();
  if (!artist || !title) return null;

  const params = new URLSearchParams({
    artist_name: artist,
    track_name: title,
    ...(song.album?.trim() ? { album_name: song.album.trim() } : {}),
    ...(Number.isFinite(song.duration) && song.duration ? { duration: String(Math.round(song.duration)) } : {})
  });

  try {
    const response = await axios.get<{ syncedLyrics?: string | null; plainLyrics?: string | null }>(
      `https://lrclib.net/api/get?${params.toString()}`,
      {
        timeout: 10000,
        headers: {
          accept: "application/json",
          "user-agent": "AlbumDeck/0.3.0 +https://github.com/Sander1384/AlbumDeck"
        }
      }
    );
    const synced = typeof response.data.syncedLyrics === "string" ? parseLrc(response.data.syncedLyrics) : [];
    if (synced.length) return { synced: true, source: "lrclib", lines: synced };

    const plain = typeof response.data.plainLyrics === "string" ? response.data.plainLyrics : "";
    const lines = plain.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((text) => ({ text }));
    return lines.length ? { synced: false, source: "lrclib", lines } : null;
  } catch {
    return null;
  }
}

export async function getLyricsForSong(cfg: NavidromeConfig, song: { id: string; artist?: string; title?: string; album?: string; duration?: number }): Promise<SongLyrics | null> {
  try {
    const bySongId = await callSubsonic<Record<string, unknown>>(cfg, "getLyricsBySongId", { id: song.id });
    const normalized = normalizeLyricsPayload(bySongId);
    if (normalized?.lines.length) return normalized;
  } catch {
    // Fall back to the older artist/title lookup below.
  }

  const artist = song.artist?.trim();
  const title = song.title?.trim();
  if (!artist || !title) return null;

  try {
    const byTitle = await callSubsonic<Record<string, unknown>>(cfg, "getLyrics", { artist, title });
    const normalized = normalizeLyricsPayload(byTitle);
    if (normalized?.lines.length) return normalized;
  } catch {
    // Fall back to LRCLIB below.
  }

  return getLrclibLyrics(song);
}

export function subsonicCoverUrl(cfg: NavidromeConfig, coverId: string, size?: number): string {
  const normalizedSize = Number.isFinite(size) && (size as number) > 0 ? Math.floor(size as number) : undefined;
  const params = new URLSearchParams({
    ...Object.fromEntries(Object.entries(authParams(cfg)).map(([k, v]) => [k, String(v)])),
    id: coverId,
    ...(normalizedSize ? { size: String(normalizedSize) } : {})
  });

  return `${cfg.navidromeUrl}/rest/getCoverArt.view?${params.toString()}`;
}

export function subsonicStreamUrl(cfg: NavidromeConfig, songId: string, options: { format?: string; maxBitRate?: number } = {}): string {
  const params = new URLSearchParams({
    ...Object.fromEntries(Object.entries(authParams(cfg)).map(([k, v]) => [k, String(v)])),
    id: songId,
    ...(options.format ? { format: options.format } : {}),
    ...(options.maxBitRate ? { maxBitRate: String(options.maxBitRate) } : {})
  });

  return `${cfg.navidromeUrl}/rest/stream.view?${params.toString()}`;
}
