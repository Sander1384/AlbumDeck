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

export type DiscogsResult = {
  title: string;
  url: string;
  images?: string[];
};

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";
const COVER_SIZE = Number((import.meta.env.VITE_COVER_SIZE as string | undefined) ?? 1200);

async function responseError(response: Response): Promise<Error> {
  try {
    const payload = (await response.json()) as { error?: string };
    return new Error(payload.error ?? `API error ${response.status}`);
  } catch {
    return new Error(`API error ${response.status}`);
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw await responseError(response);
  }
  return (await response.json()) as T;
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
  return `${API_BASE}/stream/${songId}`;
}

export function proxyImageUrl(url: string): string {
  return `${API_BASE}/image-proxy?url=${encodeURIComponent(url)}`;
}

export async function fetchDiscogsImages(url: string): Promise<string[]> {
  const response = await fetch(`${API_BASE}/discogs-images?url=${encodeURIComponent(url)}`);
  if (!response.ok) {
    throw await responseError(response);
  }
  const data = (await response.json()) as { images?: string[] };
  return data.images ?? [];
}

export async function searchDiscogs(query: string): Promise<DiscogsResult[]> {
  const response = await fetch(`${API_BASE}/discogs-search?q=${encodeURIComponent(query)}`);
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
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cover })
  });
  if (!response.ok) {
    throw await responseError(response);
  }
}

export async function deleteCustomDiscCover(albumId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/custom-disc-covers/${encodeURIComponent(albumId)}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw await responseError(response);
  }
}
