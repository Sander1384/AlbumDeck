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

export function subsonicCoverUrl(cfg: NavidromeConfig, coverId: string, size?: number): string {
  const normalizedSize = Number.isFinite(size) && (size as number) > 0 ? Math.floor(size as number) : undefined;
  const params = new URLSearchParams({
    ...Object.fromEntries(Object.entries(authParams(cfg)).map(([k, v]) => [k, String(v)])),
    id: coverId,
    ...(normalizedSize ? { size: String(normalizedSize) } : {})
  });

  return `${cfg.navidromeUrl}/rest/getCoverArt.view?${params.toString()}`;
}

export function subsonicStreamUrl(cfg: NavidromeConfig, songId: string): string {
  const params = new URLSearchParams({
    ...Object.fromEntries(Object.entries(authParams(cfg)).map(([k, v]) => [k, String(v)])),
    id: songId
  });

  return `${cfg.navidromeUrl}/rest/stream.view?${params.toString()}`;
}
