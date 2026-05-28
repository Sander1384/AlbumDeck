export type Album = {
  id: string;
  name: string;
  artist?: string;
  coverArt?: string;
  year?: number;
};

export type Song = {
  id: string;
  title: string;
  artist?: string;
  duration?: number;
};

export type LyricLine = {
  start?: number;
  text: string;
};

export type SongLyrics = {
  synced: boolean;
  lines: LyricLine[];
};

export type DiscogsResult = {
  title: string;
  artist?: string;
  url: string;
  images?: string[];
  formats?: string[];
};

export type AuthStatus = {
  configured: boolean;
  authenticated: boolean;
  username?: string;
};

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";
const COVER_SIZE = Number((import.meta.env.VITE_COVER_SIZE as string | undefined) ?? 1200);

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function responseError(response: Response): Promise<Error> {
  try {
    const payload = (await response.json()) as { error?: string };
    return new ApiError(payload.error ?? `API error ${response.status}`, response.status);
  } catch {
    return new ApiError(`API error ${response.status}`, response.status);
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!response.ok) {
    throw await responseError(response);
  }
  return (await response.json()) as T;
}

async function apiSend<T>(path: string, method: string, body?: object): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    throw await responseError(response);
  }
  return (await response.json()) as T;
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  return apiGet<AuthStatus>("/auth/status");
}

export async function setupAdmin(username: string, password: string): Promise<AuthStatus> {
  return apiSend<AuthStatus>("/auth/setup", "POST", { username, password });
}

export async function loginAdmin(username: string, password: string): Promise<AuthStatus> {
  return apiSend<AuthStatus>("/auth/login", "POST", { username, password });
}

export async function logoutAdmin(): Promise<void> {
  await apiSend<{ ok: boolean }>("/auth/logout", "POST");
}

export async function updateAdminCredentials(username: string, currentPassword: string, password: string): Promise<AuthStatus> {
  return apiSend<AuthStatus>("/auth/admin", "PUT", { username, currentPassword, password });
}

export async function fetchAlbums(): Promise<Album[]> {
  const data = await apiGet<{ albums: Album[] }>("/albums");
  return data.albums;
}

export async function fetchAlbum(id: string): Promise<{ id: string; name: string; artist?: string; coverArt?: string; song?: Song[] }> {
  const data = await apiGet<{ album: { id: string; name: string; artist?: string; coverArt?: string; song?: Song[] } }>(`/albums/${id}`);
  return data.album;
}

export function coverUrl(coverId?: string): string {
  return coverId ? `${API_BASE}/cover/${coverId}?size=${COVER_SIZE}` : "/demo-cover.svg";
}

export function streamUrl(songId: string): string {
  return `${API_BASE}/stream/${encodeURIComponent(songId)}`;
}

export async function fetchLyrics(song: Song): Promise<SongLyrics> {
  const params = new URLSearchParams();
  if (song.artist) params.set("artist", song.artist);
  if (song.title) params.set("title", song.title);
  const query = params.toString();
  return apiGet<SongLyrics>(`/lyrics/${encodeURIComponent(song.id)}${query ? `?${query}` : ""}`);
}

export async function fetchCastStreamUrl(songId: string): Promise<string> {
  const data = await apiGet<{ url: string }>(`/cast-url/${encodeURIComponent(songId)}`);
  return data.url;
}

export async function fetchCastAssetUrl(fileName: string): Promise<string> {
  const data = await apiGet<{ url: string }>(`/cast-asset/${encodeURIComponent(fileName)}`);
  return data.url;
}

export function proxyImageUrl(url: string): string {
  return `${API_BASE}/image-proxy?url=${encodeURIComponent(url)}`;
}

export async function fetchDiscogsImages(url: string): Promise<string[]> {
  const response = await fetch(`${API_BASE}/discogs-images?url=${encodeURIComponent(url)}`, { credentials: "include" });
  if (!response.ok) {
    throw await responseError(response);
  }
  const data = (await response.json()) as { images?: string[] };
  return data.images ?? [];
}

export async function searchDiscogs(query: string): Promise<DiscogsResult[]> {
  const response = await fetch(`${API_BASE}/discogs-search?q=${encodeURIComponent(query)}`, { credentials: "include" });
  if (!response.ok) {
    throw await responseError(response);
  }
  const data = (await response.json()) as { results?: DiscogsResult[] };
  return data.results ?? [];
}

export async function fetchCustomDiscCovers<T extends object>(): Promise<T> {
  const data = await apiGet<{ covers: T }>("/custom-disc-covers");
  return data.covers;
}

export async function saveCustomDiscCovers(covers: object): Promise<void> {
  const response = await fetch(`${API_BASE}/custom-disc-covers`, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ covers })
  });
  if (!response.ok) {
    throw await responseError(response);
  }
}

export async function saveCustomDiscCover(albumId: string, cover: object): Promise<void> {
  const response = await fetch(`${API_BASE}/custom-disc-covers/${encodeURIComponent(albumId)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cover })
  });
  if (!response.ok) {
    throw await responseError(response);
  }
}

export async function deleteCustomDiscCover(albumId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/custom-disc-covers/${encodeURIComponent(albumId)}`, {
    method: "DELETE",
    credentials: "include"
  });
  if (!response.ok) {
    throw await responseError(response);
  }
}
