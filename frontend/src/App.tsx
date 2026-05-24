import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  castStreamUrl,
  coverUrl,
  fetchAuthStatus,
  fetchAlbum,
  fetchAlbums,
  fetchCustomDiscCovers,
  deleteCustomDiscCover,
  fetchDiscogsImages,
  proxyImageUrl,
  saveCustomDiscCover,
  saveCustomDiscCovers,
  searchDiscogs,
  loginAdmin,
  logoutAdmin,
  setupAdmin,
  streamUrl,
  updateAdminCredentials,
  type Album,
  type AuthStatus,
  type DiscogsResult,
  type Song
} from "./api";
import "./styles/player.css";

function fmt(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60).toString();
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function cleanTrackTitle(title?: string): string {
  if (!title) return "";
  return title.replace(/^\s*\d+\s*[\.\-\)]\s*/, "").trim();
}

function hashText(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function castErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const payload = error as Record<string, unknown>;
    const parts = [payload.code, payload.description, payload.details]
      .filter((part) => typeof part === "string" && part.trim())
      .map((part) => String(part));
    if (parts.length) return parts.join(": ");
  }
  const text = String(error ?? "").trim();
  return text && text !== "[object Object]" ? text : fallback;
}

type IconName = "menu" | "close" | "admin" | "logout" | "prev" | "play" | "pause" | "next" | "sound" | "soundOff" | "fullscreen" | "fullscreenExit" | "cast" | "speed" | "image";

function Icon({ name }: { name: IconName }) {
  if (name === "menu") return <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
  if (name === "close") return <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>;
  if (name === "admin") return <svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6zM9 12l2 2 4-5" /></svg>;
  if (name === "logout") return <svg viewBox="0 0 24 24"><path d="M10 6H6v12h4M14 8l4 4-4 4M8 12h10" /></svg>;
  if (name === "prev") return <svg viewBox="0 0 24 24"><path d="M7 6v12M18 7l-8 5 8 5z" /></svg>;
  if (name === "next") return <svg viewBox="0 0 24 24"><path d="M17 6v12M6 7l8 5-8 5z" /></svg>;
  if (name === "sound") return <svg viewBox="0 0 24 24"><path d="M4 14h4l5 4V6L8 10H4zM17 9a5 5 0 0 1 0 6M19.5 6.5a8.5 8.5 0 0 1 0 11" /></svg>;
  if (name === "soundOff") return <svg viewBox="0 0 24 24"><path d="M4 14h4l5 4V6L8 10H4zM16 9l5 6M21 9l-5 6" /></svg>;
  if (name === "fullscreen") return <svg viewBox="0 0 24 24"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5" /></svg>;
  if (name === "fullscreenExit") return <svg viewBox="0 0 24 24"><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" /></svg>;
  if (name === "cast") return <svg viewBox="0 0 24 24"><path d="M4 6h16v11H4zM4 18h.01M4 14a4 4 0 0 1 4 4M4 10a8 8 0 0 1 8 8" /></svg>;
  if (name === "speed") return <svg viewBox="0 0 24 24"><path d="M12 4a8 8 0 1 0 8 8M12 8v4l3 2M17 4h4v4" /></svg>;
  if (name === "image") return <svg viewBox="0 0 24 24"><path d="M5 5h14v14H5zM8 15l3-3 2 2 2-3 3 4M8.5 8.5h.01" /></svg>;
  if (name === "pause") return <svg viewBox="0 0 24 24"><path d="M8 6h3v12H8zM13 6h3v12h-3z" /></svg>;
  return <svg viewBox="0 0 24 24"><path d="M8 6l10 6-10 6z" /></svg>;
}

type CustomDiscCover = {
  source: string;
  zoom: number;
  x: number;
  y: number;
  rotate: number;
};

type CoverEditorMode = "disc" | "back";

type BatchTarget = {
  album: Album;
  mode: CoverEditorMode;
};

type CoverDrafts = Record<CoverEditorMode, CustomDiscCover>;

type CastWindow = Window & {
  __onGCastApiAvailable?: (isAvailable: boolean) => void;
  cast?: any;
  chrome?: any;
};

const DISC_COVER_STORAGE_KEY = "cd-player-custom-disc-covers-v1";
const BACK_COVER_STORAGE_KEY = "albumdeck-custom-back-covers-v1";
const BACK_COVER_REMOTE_PREFIX = "__backcover__:";
const LOAD_SOUNDS_STORAGE_KEY = "cd-player-load-sounds-enabled-v1";
const DISC_SPEED_STORAGE_KEY = "albumdeck-disc-speed-v1";
const DISC_SPEED_DEFAULT = 100;
const APP_VERSION = "v0.3.36";
const EMPTY_COVER_DRAFT: CustomDiscCover = { source: "", zoom: 1, x: 0, y: 0, rotate: 0 };

function backCoverKey(albumId: string): string {
  return `${BACK_COVER_REMOTE_PREFIX}${albumId}`;
}

function splitCoverMaps(covers: Record<string, CustomDiscCover>) {
  const disc: Record<string, CustomDiscCover> = {};
  const back: Record<string, CustomDiscCover> = {};
  Object.entries(covers).forEach(([key, value]) => {
    if (!value?.source) return;
    if (key.startsWith(BACK_COVER_REMOTE_PREFIX)) {
      back[key.slice(BACK_COVER_REMOTE_PREFIX.length)] = value;
    } else {
      disc[key] = value;
    }
  });
  return { disc, back };
}

function joinCoverMaps(disc: Record<string, CustomDiscCover>, back: Record<string, CustomDiscCover>) {
  const merged: Record<string, CustomDiscCover> = { ...disc };
  Object.entries(back).forEach(([albumId, value]) => {
    merged[backCoverKey(albumId)] = value;
  });
  return merged;
}

function discSpinSeconds(speedValue: number): number {
  if (speedValue <= 0) return 999;
  return 0.35 + ((100 - speedValue) / 100) ** 2 * 17.65;
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const doorRef = useRef<HTMLAudioElement | null>(null);
  const spinRef = useRef<HTMLAudioElement | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const transitionTokenRef = useRef(0);
  const playTokenRef = useRef(0);
  const normalizedCoverCacheRef = useRef<Map<string, string>>(new Map());
  const castSessionRef = useRef<any>(null);
  const castOptionsReadyRef = useRef(false);
  const castListenerAttachedRef = useRef(false);
  const isCastingRef = useRef(false);
  const currentTrackRef = useRef<Song | undefined>(undefined);
  const selectedAlbumRef = useRef<Album | null>(null);
  const currentCoverSrcRef = useRef<string | null>(null);

  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [tracks, setTracks] = useState<Song[]>([]);
  const [trackIndex, setTrackIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [artistLetterFilter, setArtistLetterFilter] = useState<string>("ALL");

  const [isTrayClosing, setIsTrayClosing] = useState(false);
  const [isFastSpin, setIsFastSpin] = useState(false);
  const [isDiscFlipped, setIsDiscFlipped] = useState(false);
  const [trayMs, setTrayMs] = useState(4000);
  const [currentCoverSrc, setCurrentCoverSrc] = useState<string | null>(null);
  const [caseOverlaySrc, setCaseOverlaySrc] = useState("/CDALBUM.webp");
  const [trackListAnim, setTrackListAnim] = useState<"up" | "down" | "">("");
  const [discCoverByAlbum, setDiscCoverByAlbum] = useState<Record<string, CustomDiscCover>>({});
  const [backCoverByAlbum, setBackCoverByAlbum] = useState<Record<string, CustomDiscCover>>({});
  const [coverEditorOpen, setCoverEditorOpen] = useState(false);
  const [coverEditorMode, setCoverEditorMode] = useState<CoverEditorMode>("disc");
  const [coverSourceInput, setCoverSourceInput] = useState("");
  const [editorZoom, setEditorZoom] = useState(1);
  const [editorX, setEditorX] = useState(0);
  const [editorY, setEditorY] = useState(0);
  const [editorRotate, setEditorRotate] = useState(0);
  const [discogsCandidates, setDiscogsCandidates] = useState<string[]>([]);
  const [discogsLoading, setDiscogsLoading] = useState(false);
  const [discogsQuery, setDiscogsQuery] = useState("");
  const [discogsResults, setDiscogsResults] = useState<DiscogsResult[]>([]);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [coversLoaded, setCoversLoaded] = useState(false);
  const [topCover, setTopCover] = useState<{ src: string; angle: number; key: string } | null>(null);
  const [lowerCover, setLowerCover] = useState<{ src: string; angle: number; fading: boolean; key: string } | null>(null);
  const [isCoverInsert, setIsCoverInsert] = useState(false);
  const [isCoverBackVisible, setIsCoverBackVisible] = useState(false);
  const [loadSoundsEnabled, setLoadSoundsEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(LOAD_SOUNDS_STORAGE_KEY);
      return raw === null ? true : raw === "true";
    } catch {
      return true;
    }
  });
  const [discSpeed, setDiscSpeed] = useState<number>(DISC_SPEED_DEFAULT);
  const [speedPanelOpen, setSpeedPanelOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCastReady, setIsCastReady] = useState(false);
  const [isCasting, setIsCasting] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "setup">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminUsername, setAdminUsername] = useState("");
  const [adminCurrentPassword, setAdminCurrentPassword] = useState("");
  const [adminNewPassword, setAdminNewPassword] = useState("");
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [batchActive, setBatchActive] = useState(false);
  const [batchSkipped, setBatchSkipped] = useState<Set<string>>(() => new Set());
  const [editorDrafts, setEditorDrafts] = useState<CoverDrafts>({ disc: EMPTY_COVER_DRAFT, back: EMPTY_COVER_DRAFT });

  const coverTimersRef = useRef<number[]>([]);

  const currentTrack = tracks[trackIndex];
  const total = currentTrack?.duration ?? 0;
  const progress = useMemo(() => (total > 0 ? (elapsed / total) * 100 : 0), [elapsed, total]);
  const deckTracks = useMemo(() => {
    if (!tracks.length) return [];
    const maxVisible = Math.min(5, tracks.length);
    const start = Math.max(0, Math.min(trackIndex - 2, tracks.length - maxVisible));
    return tracks.slice(start, start + maxVisible).map((song, idx) => ({ song, absoluteIndex: start + idx }));
  }, [tracks, trackIndex]);
  const currentCustomDisc = selectedAlbum ? discCoverByAlbum[selectedAlbum.id] : undefined;
  const artistLetters = useMemo(() => {
    const letters = new Set<string>();
    albums.forEach((a) => {
      const artist = (a.artist ?? "").trim();
      if (!artist) return;
      const first = artist.charAt(0).toUpperCase();
      if (first >= "A" && first <= "Z") letters.add(first);
      else letters.add("#");
    });
    return ["ALL", ...Array.from(letters).sort((a, b) => a.localeCompare(b))];
  }, [albums]);
  const visibleAlbums = useMemo(() => {
    if (artistLetterFilter === "ALL") return albums;
    return albums.filter((a) => {
      const artist = (a.artist ?? "").trim();
      if (!artist) return artistLetterFilter === "#";
      const first = artist.charAt(0).toUpperCase();
      if (first >= "A" && first <= "Z") return first === artistLetterFilter;
      return artistLetterFilter === "#";
    });
  }, [albums, artistLetterFilter]);
  const unfinishedAlbums = useMemo(
    () => albums.filter((album) => !discCoverByAlbum[album.id]?.source || !backCoverByAlbum[album.id]?.source),
    [albums, discCoverByAlbum, backCoverByAlbum]
  );

  const refreshAuth = async () => {
    const state = await fetchAuthStatus();
    setAuthStatus(state);
    setAuthMode(state.configured ? "login" : "setup");
    setAdminUsername(state.username ?? "");
    return state;
  };

  useEffect(() => {
    void refreshAuth().catch((e) => {
      setAuthError(e instanceof Error ? e.message : "Could not check login status");
      setAuthStatus({ configured: false, authenticated: false });
      setAuthMode("setup");
    });
  }, []);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
    selectedAlbumRef.current = selectedAlbum;
    currentCoverSrcRef.current = currentCoverSrc;
    isCastingRef.current = isCasting;
  }, [currentTrack, currentCoverSrc, isCasting, selectedAlbum]);

  useEffect(() => {
    setIsCoverBackVisible(false);
  }, [topCover?.key, currentCoverSrc, selectedAlbum?.id]);

  useEffect(() => {
    if (!authStatus?.authenticated) return;
    const loadCovers = async () => {
      let localDisc: Record<string, CustomDiscCover> = {};
      let localBack: Record<string, CustomDiscCover> = {};
      try {
        const raw = localStorage.getItem(DISC_COVER_STORAGE_KEY);
        if (raw) {
          localDisc = JSON.parse(raw) as Record<string, CustomDiscCover>;
        }
        const backRaw = localStorage.getItem(BACK_COVER_STORAGE_KEY);
        if (backRaw) {
          localBack = JSON.parse(backRaw) as Record<string, CustomDiscCover>;
        }
      } catch {
        localDisc = {};
        localBack = {};
      }

      try {
        const remote = await fetchCustomDiscCovers<Record<string, CustomDiscCover>>();
        const remoteSplit = splitCoverMaps(remote ?? {});
        const mergedDisc = { ...localDisc, ...remoteSplit.disc };
        const mergedBack = { ...localBack, ...remoteSplit.back };
        setDiscCoverByAlbum(mergedDisc);
        setBackCoverByAlbum(mergedBack);
        if (Object.keys(localDisc).length > 0 || Object.keys(localBack).length > 0) {
          void saveCustomDiscCovers(joinCoverMaps(mergedDisc, mergedBack)).catch(() => {
            // keep local fallback
          });
        }
      } catch {
        setDiscCoverByAlbum(localDisc);
        setBackCoverByAlbum(localBack);
      } finally {
        setCoversLoaded(true);
      }
    };
    void loadCovers();
  }, [authStatus?.authenticated]);

  useEffect(() => {
    if (!coversLoaded) return;
    localStorage.setItem(DISC_COVER_STORAGE_KEY, JSON.stringify(discCoverByAlbum));
    localStorage.setItem(BACK_COVER_STORAGE_KEY, JSON.stringify(backCoverByAlbum));
  }, [discCoverByAlbum, backCoverByAlbum, coversLoaded]);

  useEffect(() => {
    localStorage.setItem(LOAD_SOUNDS_STORAGE_KEY, String(loadSoundsEnabled));
  }, [loadSoundsEnabled]);

  useEffect(() => {
    localStorage.removeItem(DISC_SPEED_STORAGE_KEY);
  }, []);

  const stopFadeTimer = () => {
    if (fadeTimerRef.current !== null) {
      window.clearInterval(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  };

  const clearCoverTimers = () => {
    coverTimersRef.current.forEach((t) => window.clearTimeout(t));
    coverTimersRef.current = [];
  };

  const randomTilt = (min: number, max: number) => Math.random() * (max - min) + min;

  const normalizeCoverImage = async (src: string, size = 1200): Promise<string> => {
    const img = new Image();
    img.decoding = "async";
    img.crossOrigin = "anonymous";

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        img.onload = null;
        img.onerror = null;
        reject(new Error("Cover loading timed out"));
      }, 10000);
      img.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("Could not load cover"));
      };
      img.onload = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      img.src = src;
    });

    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    if (!sw || !sh) return src;

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return src;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Fill square with a soft blurred version first so non-square covers don't show hard bars.
    ctx.save();
    ctx.filter = "blur(28px) saturate(0.95) brightness(0.9)";
    const bgScale = Math.max(size / sw, size / sh);
    const bgW = sw * bgScale;
    const bgH = sh * bgScale;
    const bgX = (size - bgW) / 2;
    const bgY = (size - bgH) / 2;
    ctx.drawImage(img, bgX, bgY, bgW, bgH);
    ctx.restore();

    // Draw the full cover without cropping (contain).
    const scale = Math.min(size / sw, size / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = (size - dw) / 2;
    const dy = (size - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);

    return canvas.toDataURL("image/jpeg", 0.94);
  };

  useEffect(() => {
    if (!trackListAnim) return;
    const t = window.setTimeout(() => setTrackListAnim(""), 260);
    return () => window.clearTimeout(t);
  }, [trackListAnim]);

  const getNormalizedCover = async (coverId?: string): Promise<string> => {
    if (!coverId) return "/demo-cover.svg";
    const key = String(coverId);
    const cached = normalizedCoverCacheRef.current.get(key);
    if (cached) return cached;

    const raw = coverUrl(coverId);
    try {
      const normalized = await normalizeCoverImage(raw, 1200);
      normalizedCoverCacheRef.current.set(key, normalized);
      return normalized;
    } catch {
      normalizedCoverCacheRef.current.set(key, raw);
      return raw;
    }
  };

  const placeCoverOnStack = (src: string) => {
    clearCoverTimers();

    setLowerCover((currentLower) => {
      if (topCover) {
        return { src: topCover.src, angle: randomTilt(-7, 7), fading: false, key: `${Date.now()}-lower` };
      }
      return currentLower;
    });

    setTopCover({ src, angle: randomTilt(-4, 4), key: `${Date.now()}-top` });
    setIsCoverInsert(true);

    coverTimersRef.current.push(
      window.setTimeout(() => setIsCoverInsert(false), 680),
      window.setTimeout(() => setLowerCover((c) => (c ? { ...c, fading: true } : c)), 30000),
      window.setTimeout(() => setLowerCover(null), 31500)
    );
  };

  const ensureAudioReady = async (el: HTMLAudioElement | null) => {
    if (!el) return;
    if (el.readyState >= 2) return;
    await new Promise<void>((resolve) => {
      const cleanup = () => {
        window.clearTimeout(timeout);
        el.removeEventListener("canplay", onReady);
        el.removeEventListener("canplaythrough", onReady);
        el.removeEventListener("loadedmetadata", onReady);
        el.removeEventListener("error", onReady);
      };
      const onReady = () => {
        cleanup();
        resolve();
      };
      const timeout = window.setTimeout(onReady, 2500);
      el.addEventListener("canplay", onReady);
      el.addEventListener("canplaythrough", onReady);
      el.addEventListener("loadedmetadata", onReady);
      el.addEventListener("error", onReady);
      el.load();
    });
  };

  const getAudioDurationMs = (el: HTMLAudioElement | null, fallbackMs: number) => {
    if (!el) return fallbackMs;
    const d = el.duration;
    if (!Number.isFinite(d) || d <= 0) return fallbackMs;
    return Math.round(d * 1000);
  };

  const absoluteUrl = (url: string) => new URL(url, window.location.href).toString();

  const loadCastMedia = async (song: Song) => {
    const win = window as CastWindow;
    const session = castSessionRef.current;
    if (!session || !win.chrome?.cast) return false;

    const album = selectedAlbumRef.current;
    const mediaInfo = new win.chrome.cast.media.MediaInfo(absoluteUrl(castStreamUrl(song.id)), "audio/mpeg");
    mediaInfo.streamType = win.chrome.cast.media.StreamType.BUFFERED;
    if (Number.isFinite(song.duration) && song.duration && song.duration > 0) mediaInfo.duration = song.duration;

    const metadata = new win.chrome.cast.media.MusicTrackMediaMetadata();
    metadata.title = cleanTrackTitle(song.title) || song.title || "AlbumDeck";
    metadata.artist = song.artist ?? album?.artist ?? "";
    metadata.albumName = album?.name ?? "";

    mediaInfo.metadata = metadata;

    const request = new win.chrome.cast.media.LoadRequest(mediaInfo);
    request.autoplay = true;
    const errorCode = await session.loadMedia(request);
    if (errorCode) throw new Error(String(errorCode));
    setIsPlaying(true);
    return true;
  };

  const toggleCastPlayback = async () => {
    const win = window as CastWindow;
    const media = castSessionRef.current?.getMediaSession?.();
    if (!media || !win.chrome?.cast) return;

    const isRemotePlaying = media.playerState === win.chrome.cast.media.PlayerState.PLAYING;
    await new Promise<void>((resolve, reject) => {
      const done = () => resolve();
      const fail = (err: unknown) => reject(err instanceof Error ? err : new Error("Cast control failed"));
      if (isRemotePlaying) media.pause(null, done, fail);
      else media.play(null, done, fail);
    });
    setIsPlaying(!isRemotePlaying);
  };

  const requestCastSession = async () => {
    const win = window as CastWindow;
    if (!window.isSecureContext) {
      setError("Cast does not work over HTTP. Open AlbumDeck over HTTPS on a hostname your Chromecast can also reach.");
      return;
    }

    if (!win.cast?.framework || !win.chrome?.cast) {
      setError("Cast is not available in this browser. Use Chrome/Chromium, HTTPS, and the same network as your Chromecast.");
      return;
    }

    try {
      const context = configureCastContext(win);
      if (!context) {
        setError("Cast is not ready yet. Wait a moment and try again.");
        return;
      }
      const session = context.getCurrentSession() ?? await context.requestSession();
      castSessionRef.current = session;
      setIsCasting(Boolean(session));
      audioRef.current?.pause();

      const song = currentTrackRef.current;
      if (song) await loadCastMedia(song);
    } catch (e) {
      const message = castErrorMessage(e, "");
      if (!message.includes("cancel")) {
        setError(message || "Could not start Cast");
      }
    }
  };

  const playTrackImmediate = async (song: Song) => {
    const audio = audioRef.current;
    if (!audio) return;
    const myPlayToken = ++playTokenRef.current;

    stopFadeTimer();
    audio.pause();
    setIsFastSpin(false);

    if (isCastingRef.current && castSessionRef.current) {
      await loadCastMedia(song);
      return;
    }

    audio.src = streamUrl(song.id);
    audio.volume = 1;
    audio.load();

    try {
      await audio.play();
    } catch (err) {
      if (myPlayToken !== playTokenRef.current) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      throw err;
    }
    if (myPlayToken !== playTokenRef.current) return;
    setIsPlaying(true);
  };

  const openAlbumWithSequence = async (album: Album, opts?: { animate?: boolean; play?: boolean }) => {
    const animate = opts?.animate ?? true;
    const shouldPlay = opts?.play ?? true;
    const token = Date.now();
    transitionTokenRef.current = token;
    setError(null);

    try {
      const detail = await fetchAlbum(album.id);
      if (transitionTokenRef.current !== token) return;
      const songs = detail.song ?? [];
      const firstSong = songs[0];
      if (!firstSong) return;
      const normalizedCover = await getNormalizedCover(detail.coverArt ?? album.coverArt);
      if (transitionTokenRef.current !== token) return;

      setMenuOpen(false);
      setElapsed(0);

      if (!animate) {
        if (!shouldPlay && audioRef.current) {
          playTokenRef.current += 1;
          audioRef.current.pause();
          setIsPlaying(false);
        }
        setSelectedAlbum(album);
        setTracks(songs);
        setTrackIndex(0);
        setCurrentCoverSrc(normalizedCover);
        placeCoverOnStack(normalizedCover);
        setIsDiscFlipped(false);
        setIsFastSpin(false);
        setIsTrayClosing(false);
        if (shouldPlay) {
          await playTrackImmediate(firstSong);
        }
        return;
      }

      const main = audioRef.current;
      if (main) {
        playTokenRef.current += 1;
        main.pause();
        main.volume = 1;
      }
      setIsPlaying(false);
      setIsFastSpin(false);
      setSelectedAlbum(album);
      setTracks(songs);
      setTrackIndex(0);
      setCurrentCoverSrc(normalizedCover);
      placeCoverOnStack(normalizedCover);
      setIsDiscFlipped(false);
      if (loadSoundsEnabled) {
        await ensureAudioReady(doorRef.current);
      }
      const closeMs = loadSoundsEnabled ? getAudioDurationMs(doorRef.current, 4000) : 4000;
      setTrayMs(closeMs);
      setIsTrayClosing(true);
      if (loadSoundsEnabled && doorRef.current) {
        doorRef.current.currentTime = 0;
        doorRef.current.volume = 1;
        void doorRef.current.play();
      }
      await new Promise((resolve) => window.setTimeout(resolve, closeMs));
      if (transitionTokenRef.current !== token) return;
      setIsTrayClosing(false);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      if (transitionTokenRef.current !== token) return;

      if (loadSoundsEnabled) {
        await ensureAudioReady(spinRef.current);
      }
      const spinMs = loadSoundsEnabled ? getAudioDurationMs(spinRef.current, 1400) : 1400;
      if (loadSoundsEnabled && spinRef.current) {
        spinRef.current.currentTime = 0;
        spinRef.current.volume = 1;
        void spinRef.current.play();
      }

      setIsFastSpin(true);
      window.setTimeout(() => {
        if (transitionTokenRef.current === token) {
          setIsDiscFlipped(true);
        }
      }, Math.max(0, spinMs - 350));

      await new Promise((resolve) => window.setTimeout(resolve, spinMs));
      if (transitionTokenRef.current !== token) return;

      await playTrackImmediate(firstSong);
    } catch (e) {
      if (transitionTokenRef.current === token) {
        setIsTrayClosing(false);
        setIsFastSpin(false);
        setIsCoverInsert(false);
        setError(e instanceof Error ? e.message : "Could not open album");
      }
    }
  };

  useEffect(() => {
    if (!authStatus?.authenticated) return;
    const load = async () => {
      try {
        const loaded = await fetchAlbums();
        setAlbums(loaded);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load albums");
      }
    };
    load();
    if (doorRef.current) {
      doorRef.current.load();
    }
    if (spinRef.current) {
      spinRef.current.load();
    }
    const overlay = new Image();
    overlay.onerror = () => {
      setCaseOverlaySrc("/CDHOES4.png");
    };
    overlay.src = "/CDALBUM.webp";

    return () => {
      stopFadeTimer();
      clearCoverTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus?.authenticated]);

  useEffect(() => {
    let disposed = false;
    const win = window as CastWindow;

    const initializeCast = (isAvailable: boolean) => {
      if (disposed || !isAvailable || !win.cast?.framework || !win.chrome?.cast) return;

      const context = configureCastContext(win);
      if (!context || castListenerAttachedRef.current) return;
      castListenerAttachedRef.current = true;

      castSessionRef.current = context.getCurrentSession();
      setIsCasting(Boolean(castSessionRef.current));

      context.addEventListener(win.cast.framework.CastContextEventType.SESSION_STATE_CHANGED, (event: any) => {
        const state = event.sessionState;
        const active =
          state === win.cast.framework.SessionState.SESSION_STARTED ||
          state === win.cast.framework.SessionState.SESSION_RESUMED;

        castSessionRef.current = active ? context.getCurrentSession() : null;
        setIsCasting(active);

        if (active) {
          audioRef.current?.pause();
          const song = currentTrackRef.current;
          if (song) void loadCastMedia(song).catch((e) => setError(castErrorMessage(e, "Could not load Cast media")));
        }
      });
    };

    if (win.cast?.framework && win.chrome?.cast) {
      initializeCast(true);
    } else {
      win.__onGCastApiAvailable = initializeCast;
    }

    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function configureCastContext(win: CastWindow) {
    if (!win.cast?.framework || !win.chrome?.cast) return null;
    const context = win.cast.framework.CastContext.getInstance();
    if (!castOptionsReadyRef.current) {
      context.setOptions({
        receiverApplicationId: win.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: win.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
      });
      castOptionsReadyRef.current = true;
      setIsCastReady(true);
    }
    return context;
  }

  const togglePlay = async () => {
    if (isCastingRef.current) {
      await toggleCastPlayback();
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const prev = async () => {
    if (!tracks.length) return;
    setTrackListAnim("down");
    const idx = (trackIndex - 1 + tracks.length) % tracks.length;
    setTrackIndex(idx);
    setElapsed(0);
    await playTrackImmediate(tracks[idx]);
  };

  const next = async () => {
    if (!tracks.length) return;
    setTrackListAnim("up");
    const idx = (trackIndex + 1) % tracks.length;
    setTrackIndex(idx);
    setElapsed(0);
    await playTrackImmediate(tracks[idx]);
  };

  const seek = (value: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(value)) return;
    audio.currentTime = value;
    setElapsed(value);
  };

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    onFullscreenChange();
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await document.documentElement.requestFullscreen();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fullscreen is not available");
    }
  };

  const art = topCover?.src ?? currentCoverSrc ?? coverUrl(selectedAlbum?.coverArt);
  const hasDiscArt = Boolean(topCover || selectedAlbum);
  const currentCustomBack = selectedAlbum ? backCoverByAlbum[selectedAlbum.id] : undefined;
  const displayCoverSrc = topCover?.src ?? currentCoverSrc ?? (selectedAlbum ? coverUrl(selectedAlbum.coverArt) : null);
  const backImageSource = currentCustomBack ? resolveEditorPreviewSource(currentCustomBack.source) : displayCoverSrc;
  const backImageStyle = currentCustomBack
    ? {
        transform: `translate(${currentCustomBack.x}px, ${currentCustomBack.y}px) scale(${currentCustomBack.zoom}) rotate(${currentCustomBack.rotate}deg)`
      }
    : undefined;
  const discSource = currentCustomDisc ? resolveEditorPreviewSource(currentCustomDisc.source) : art;
  const discArtStyle = currentCustomDisc
    ? {
        transform: `translate(${currentCustomDisc.x}px, ${currentCustomDisc.y}px) scale(${currentCustomDisc.zoom}) rotate(${currentCustomDisc.rotate}deg)`
      }
    : undefined;

  const currentEditorDraft = (): CustomDiscCover => ({
    source: coverSourceInput,
    zoom: editorZoom,
    x: editorX,
    y: editorY,
    rotate: editorRotate
  });

  const applyEditorDraft = (draft?: CustomDiscCover) => {
    const next = draft ?? EMPTY_COVER_DRAFT;
    setCoverSourceInput(next.source);
    setEditorZoom(next.zoom);
    setEditorX(next.x);
    setEditorY(next.y);
    setEditorRotate(next.rotate);
  };

  const batchKey = (albumId: string, mode: CoverEditorMode) => `${albumId}:${mode}`;

  const openCoverEditorFor = (album: Album, mode: CoverEditorMode = "disc") => {
    const drafts = {
      disc: discCoverByAlbum[album.id] ?? EMPTY_COVER_DRAFT,
      back: backCoverByAlbum[album.id] ?? EMPTY_COVER_DRAFT
    };
    setCoverEditorMode(mode);
    setEditorDrafts(drafts);
    applyEditorDraft(drafts[mode]);
    setDiscogsCandidates([]);
    setDiscogsQuery(album.artist ? `${album.artist} ${album.name}` : album.name);
    setDiscogsResults([]);
    setEditorError(null);
    setCoverEditorOpen(true);
  };

  const openCoverEditor = (mode: CoverEditorMode = "disc") => {
    if (!selectedAlbum) return;
    openCoverEditorFor(selectedAlbum, mode);
  };

  const nextBatchTarget = (
    discMap: Record<string, CustomDiscCover> = discCoverByAlbum,
    backMap: Record<string, CustomDiscCover> = backCoverByAlbum,
    skipped: Set<string> = batchSkipped
  ): BatchTarget | null => {
    for (const album of albums) {
      if (!discMap[album.id]?.source && !skipped.has(batchKey(album.id, "disc"))) return { album, mode: "disc" };
      if (!backMap[album.id]?.source && !skipped.has(batchKey(album.id, "back"))) return { album, mode: "back" };
    }
    return null;
  };

  const openBatchTarget = async (target: BatchTarget) => {
    setBatchActive(true);
    setMenuOpen(false);
    await openAlbumWithSequence(target.album, { animate: false, play: false });
    openCoverEditorFor(target.album, target.mode);
  };

  const startBatch = async () => {
    const skipped = new Set<string>();
    setBatchSkipped(skipped);
    const target = nextBatchTarget(discCoverByAlbum, backCoverByAlbum, skipped);
    if (!target) {
      setError("All albums already have CD artwork and sleeve backs.");
      return;
    }
    await openBatchTarget(target);
  };

  const advanceBatch = async (discMap: Record<string, CustomDiscCover>, backMap: Record<string, CustomDiscCover>) => {
    const target = nextBatchTarget(discMap, backMap);
    if (!target) {
      setBatchActive(false);
      setCoverEditorOpen(false);
      setError("Batch complete: all albums have CD artwork and sleeve backs.");
      return;
    }
    await openBatchTarget(target);
  };

  const skipBatchItem = async () => {
    if (!selectedAlbum) return;
    const skipped = new Set(batchSkipped);
    skipped.add(batchKey(selectedAlbum.id, coverEditorMode));
    setBatchSkipped(skipped);
    const target = nextBatchTarget(discCoverByAlbum, backCoverByAlbum, skipped);
    if (!target) {
      setBatchActive(false);
      setCoverEditorOpen(false);
      setError("Batch complete for this pass. Skipped items were left unchanged.");
      return;
    }
    await openBatchTarget(target);
  };

  const logout = async () => {
    audioRef.current?.pause();
    await logoutAdmin();
    setSelectedAlbum(null);
    setTracks([]);
    setTrackIndex(0);
    setElapsed(0);
    setIsPlaying(false);
    setAdminOpen(false);
    setAuthUsername("");
    setAuthPassword("");
    const state = await refreshAuth();
    setAuthStatus({ ...state, authenticated: false });
  };

  const submitAuth = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    try {
      const state = authMode === "setup"
        ? await setupAdmin(authUsername, authPassword)
        : await loginAdmin(authUsername, authPassword);
      setAuthStatus(state);
      setAdminUsername(state.username ?? authUsername);
      setAuthPassword("");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setAuthBusy(false);
    }
  };

  const submitAdmin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAdminBusy(true);
    setAdminMessage(null);
    try {
      const state = await updateAdminCredentials(adminUsername, adminCurrentPassword, adminNewPassword);
      setAuthStatus(state);
      setAdminUsername(state.username ?? adminUsername);
      setAdminCurrentPassword("");
      setAdminNewPassword("");
      setAdminMessage("Admin login updated.");
    } catch (err) {
      setAdminMessage(err instanceof Error ? err.message : "Could not update admin");
    } finally {
      setAdminBusy(false);
    }
  };

  const switchCoverEditorMode = (mode: CoverEditorMode) => {
    if (!selectedAlbum || mode === coverEditorMode) return;
    const drafts = { ...editorDrafts, [coverEditorMode]: currentEditorDraft() };
    const c = drafts[mode];
    setCoverEditorMode(mode);
    setEditorDrafts(drafts);
    applyEditorDraft(c);
    setDiscogsCandidates([]);
    setEditorError(null);
  };

  function resolveEditorPreviewSource(source: string) {
    if (!source) return art;
    if (source.startsWith("data:")) return source;
    if (/^https?:\/\//i.test(source)) {
      const host = new URL(source).hostname.toLowerCase();
      const isDiscogsImageHost = ["i.discogs.com", "img.discogs.com", "api-img.discogs.com"].includes(host);
      const isLikelyImage = /\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(source) || isDiscogsImageHost;
      if (!isLikelyImage) return art;
      return proxyImageUrl(source);
    }
    return source;
  }

  const saveEditorCover = () => {
    if (!selectedAlbum) return;
    const albumId = selectedAlbum.id;
    const drafts = { ...editorDrafts, [coverEditorMode]: currentEditorDraft() };
    const discDraft = { ...drafts.disc, source: drafts.disc.source.trim() };
    const backDraft = { ...drafts.back, source: drafts.back.source.trim() };

    if (batchActive && !drafts[coverEditorMode].source.trim()) {
      setEditorError("Choose artwork or use Skip for this batch item.");
      return;
    }

    const nextDisc = { ...discCoverByAlbum };
    const nextBack = { ...backCoverByAlbum };

    if (discDraft.source) nextDisc[albumId] = discDraft;
    else delete nextDisc[albumId];

    if (backDraft.source) nextBack[albumId] = backDraft;
    else delete nextBack[albumId];

    setDiscCoverByAlbum(nextDisc);
    setBackCoverByAlbum(nextBack);
    setEditorDrafts({ disc: discDraft, back: backDraft });

    void Promise.all([
      discDraft.source ? saveCustomDiscCover(albumId, discDraft) : deleteCustomDiscCover(albumId),
      backDraft.source ? saveCustomDiscCover(backCoverKey(albumId), backDraft) : deleteCustomDiscCover(backCoverKey(albumId))
    ]).catch((e) => {
      setError(e instanceof Error ? e.message : "Could not save covers");
    });

    setCoverEditorOpen(false);
    if (batchActive) {
      void advanceBatch(nextDisc, nextBack);
    }
  };

  const lookupDiscogsImages = async (explicitUrl?: string) => {
    const src = (explicitUrl ?? coverSourceInput).trim();
    if (!src) return;
    try {
      setEditorError(null);
      setDiscogsLoading(true);
      const images = await fetchDiscogsImages(src);
      setDiscogsCandidates(images);
      if (images.length > 0) {
        setCoverSourceInput(images[0]);
      } else {
        setEditorError("No images found on this Discogs page.");
      }
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : "Discogs lookup failed");
    } finally {
      setDiscogsLoading(false);
    }
  };

  const lookupDiscogsByQuery = async () => {
    const q = discogsQuery.trim();
    if (!q) return;
    try {
      setEditorError(null);
      setDiscogsLoading(true);
      const results = await searchDiscogs(q);
      setDiscogsResults(results);
      if (!results.length) {
        setEditorError("No Discogs results found.");
      }
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : "Discogs search failed");
    } finally {
      setDiscogsLoading(false);
    }
  };

  if (!authStatus) {
    return (
      <main className="auth-shell">
        <div className="auth-card compact-auth">
          <img src="/cd.svg" className="auth-logo" alt="AlbumDeck" />
          <h1>AlbumDeck</h1>
          <p>Loading...</p>
        </div>
      </main>
    );
  }

  if (!authStatus.authenticated) {
    const isSetup = authMode === "setup";
    return (
      <main className="auth-shell">
        <form className="auth-card" onSubmit={(e) => void submitAuth(e)}>
          <img src="/cd.svg" className="auth-logo" alt="AlbumDeck" />
          <h1>AlbumDeck</h1>
          <h2>{isSetup ? "Create admin login" : "Log in"}</h2>
          <p>{isSetup ? "Choose the username and password for this AlbumDeck." : "Username and password are case-sensitive."}</p>
          <label htmlFor="auth-user">Username</label>
          <input
            id="auth-user"
            value={authUsername}
            onChange={(e) => setAuthUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
          <label htmlFor="auth-pass">Password</label>
          <input
            id="auth-pass"
            type="password"
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            autoComplete={isSetup ? "new-password" : "current-password"}
          />
          {authError ? <p className="auth-error">{authError}</p> : null}
          <button className="auth-submit" disabled={authBusy}>{authBusy ? "Please wait..." : isSetup ? "Create login" : "Log in"}</button>
        </form>
      </main>
    );
  }

  if (adminOpen) {
    return (
      <main className="auth-shell">
        <form className="auth-card admin-card" onSubmit={(e) => void submitAdmin(e)}>
          <img src="/cd.svg" className="auth-logo" alt="AlbumDeck" />
          <h1>AlbumDeck</h1>
          <h2>Admin</h2>
          <p>Change the app login for this AlbumDeck.</p>
          <label htmlFor="admin-user">Username</label>
          <input id="admin-user" value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} autoComplete="username" />
          <label htmlFor="admin-current-pass">Current password</label>
          <input
            id="admin-current-pass"
            type="password"
            value={adminCurrentPassword}
            onChange={(e) => setAdminCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
          <label htmlFor="admin-new-pass">New password</label>
          <input
            id="admin-new-pass"
            type="password"
            value={adminNewPassword}
            onChange={(e) => setAdminNewPassword(e.target.value)}
            placeholder="Leave empty to keep current password"
            autoComplete="new-password"
          />
          {adminMessage ? <p className="auth-error">{adminMessage}</p> : null}
          <div className="auth-actions">
            <button type="button" className="auth-secondary" onClick={() => setAdminOpen(false)}>Back</button>
            <button className="auth-submit" disabled={adminBusy}>{adminBusy ? "Saving..." : "Save"}</button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell theme-dark">
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setElapsed((e.target as HTMLAudioElement).currentTime)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => void next()}
      />
      <audio ref={doorRef} src="/door.mp3" preload="auto" />
      <audio ref={spinRef} src="/draai.mp3" preload="auto" />
      <div className="build-badge" aria-label={`AlbumDeck version ${APP_VERSION}`}>{APP_VERSION}</div>

      <section className="stage">
        <div className="stage-cover">
          <div
            className={`jewel-case ${isCoverBackVisible ? "show-back" : ""}`}
            role={selectedAlbum ? "button" : undefined}
            tabIndex={selectedAlbum ? 0 : undefined}
            aria-label={selectedAlbum ? "Show the front or back of the sleeve" : undefined}
            onClick={() => selectedAlbum && setIsCoverBackVisible((visible) => !visible)}
            onKeyDown={(e) => {
              if (!selectedAlbum) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsCoverBackVisible((visible) => !visible);
              }
            }}
          >
            {lowerCover ? (
              <div
                key={lowerCover.key}
                className={`stack-card stack-lower ${lowerCover.fading ? "fading" : ""}`}
                style={{ ["--tilt" as string]: `${lowerCover.angle}deg` }}
              >
                <img src={lowerCover.src} className="stack-art" alt="" aria-hidden="true" />
                <img src={caseOverlaySrc} className="stack-case-overlay" alt="" aria-hidden="true" />
              </div>
            ) : null}
            {displayCoverSrc && selectedAlbum ? (
              <div
                key={topCover?.key ?? selectedAlbum.id}
                className={`stack-card stack-top ${isCoverInsert ? "insert" : ""}`}
                style={{ ["--tilt" as string]: `${topCover?.angle ?? 0}deg` }}
              >
                <div className="cover-flip-inner">
                  <div className="cover-face cover-face-front">
                    <img src={displayCoverSrc} className="stack-art" alt={selectedAlbum.name} />
                    <img src={caseOverlaySrc} className="stack-case-overlay" alt="" aria-hidden="true" />
                  </div>
                  <div className="cover-face cover-face-back" aria-hidden={!isCoverBackVisible}>
                    <div className="back-cover-frame">
                      <img src="/backcover.png" className="back-cover-template" alt="" aria-hidden="true" />
                      <div className="back-cover-inlay-window" aria-hidden="true">
                        {backImageSource ? (
                          <img
                            src={backImageSource}
                            className="back-cover-inlay"
                            style={backImageStyle}
                            alt=""
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="cover-empty" aria-label="No album selected">
                <div className="empty-brand">
                  <span>Choose an album from the menu</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="stage-disc">
          <div
            className={`disc ${(!hasDiscArt || discSpeed <= 0) && !isFastSpin && !isTrayClosing ? "paused" : ""} ${isFastSpin ? "fast" : ""} ${isTrayClosing ? "closing" : ""} ${hasDiscArt ? "" : "empty"} ${currentCustomDisc ? "custom-disc" : ""}`}
            style={{
              ["--tray-ms" as string]: `${trayMs}ms`,
              ["--disc-spin" as string]: `${discSpinSeconds(discSpeed)}s`
            }}
          >
            {hasDiscArt ? <img src={discSource} className="disc-album-art" style={discArtStyle} alt="" aria-hidden="true" /> : null}
            {currentCustomDisc ? (
              <div className="disc-hub-mask" aria-hidden="true">
                <span className="disc-hub-ring" />
                <span className="disc-hub-hole" />
              </div>
            ) : null}
            <img src="/rand.png" className={`disc-center-overlay ${isDiscFlipped ? "fade-out" : ""}`} alt="" aria-hidden="true" />
            <img src="/rand2.png" className={`disc-center-overlay overlay-top ${isDiscFlipped ? "fade-in" : ""}`} alt="" aria-hidden="true" />
          </div>
        </div>
      </section>

      <footer className="player-bar">
        <div className="deck-top">
          <div className="deck-transport">
            <button className="line-btn ghost-line text-line" onClick={() => setMenuOpen(true)} aria-label="Open CD rack">CD</button>
            <div className="speed-control">
              <button
                className={`line-btn ghost-line ${speedPanelOpen ? "active-line" : ""}`}
                onClick={() => setSpeedPanelOpen((open) => !open)}
                aria-label="Adjust CD spin speed"
                aria-expanded={speedPanelOpen}
                title="Adjust CD spin speed"
              >
                <Icon name="speed" />
              </button>
              {speedPanelOpen ? (
                <div className="speed-popover" onClick={(e) => e.stopPropagation()}>
                  <input
                    className="speed-slider"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={discSpeed}
                    onChange={(e) => setDiscSpeed(Number(e.target.value))}
                    onInput={(e) => setDiscSpeed(Number((e.target as HTMLInputElement).value))}
                    aria-label="CD spin speed"
                    title={`CD speed ${discSpeed}%`}
                  />
                </div>
              ) : null}
            </div>
            <button
              className={`line-btn ghost-line cast-btn ${isCasting ? "casting" : ""}`}
              onClick={() => void requestCastSession()}
              aria-label="Cast to Chromecast"
              title={isCastReady ? "Cast to Chromecast" : "Cast not available"}
            >
              <Icon name="cast" />
            </button>
            <button
              className="line-btn ghost-line"
              onClick={() => setLoadSoundsEnabled((v) => !v)}
              aria-label={loadSoundsEnabled ? "Disable load sounds" : "Enable load sounds"}
              title={loadSoundsEnabled ? "Load sounds on" : "Load sounds off"}
            >
              <Icon name={loadSoundsEnabled ? "sound" : "soundOff"} />
            </button>
            <button
              className="line-btn ghost-line"
              onClick={() => void toggleFullscreen()}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              <Icon name={isFullscreen ? "fullscreenExit" : "fullscreen"} />
            </button>
            <div className="utility-controls" aria-label="Album and admin tools">
              <button className="line-btn ghost-line" onClick={() => openCoverEditor()} aria-label="Set artwork"><Icon name="image" /></button>
              <button className="line-btn ghost-line" onClick={() => setAdminOpen(true)} aria-label="Admin settings" title="Admin settings"><Icon name="admin" /></button>
              <button className="line-btn ghost-line logout-line" onClick={() => void logout()} aria-label="Log out" title="Log out"><Icon name="logout" /></button>
            </div>
          </div>
        </div>

        <div className="deck-middle">
          <ol className={`deck-tracklist ${trackListAnim ? `anim-${trackListAnim}` : ""}`}>
            {deckTracks.map(({ song, absoluteIndex }) => (
              <li key={song.id} className={absoluteIndex === trackIndex ? "active" : ""}>
                <span className="track-no">{absoluteIndex + 1}.</span> {cleanTrackTitle(song.title) || `Track ${absoluteIndex + 1}`}
              </li>
            ))}
          </ol>
        </div>

        <div className="deck-bottom">
          <div className="bottom-transport">
            <button className="line-btn" onClick={() => void prev()} aria-label="Previous"><Icon name="prev" /></button>
            <button className="line-btn play-line" onClick={() => void togglePlay()} aria-label="Play Pause"><Icon name={isPlaying ? "pause" : "play"} /></button>
            <button className="line-btn" onClick={() => void next()} aria-label="Next"><Icon name="next" /></button>
            <span className="track-label" aria-live="polite">
              {currentTrack ? `Track ${(trackIndex + 1).toString().padStart(2, "0")}` : "Track --"}
            </span>
          </div>
          <div className="seek-row">
            <span>{fmt(elapsed)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(total, 1)}
              value={Math.min(elapsed, Math.max(total, 1))}
              onChange={(e) => seek(Number(e.target.value))}
              className="slider"
              style={{ backgroundSize: `${progress}% 100%` }}
            />
            <span>{fmt(total)}</span>
          </div>
        </div>
      </footer>

      {menuOpen ? (
        <div className="menu-overlay" role="dialog" aria-modal="true">
          <div className="menu-panel">
            <div className="menu-head">
              <h2>CD Rack</h2>
              <div className="menu-actions">
                <button className="menu-action-btn" onClick={() => void startBatch()} disabled={!unfinishedAlbums.length}>
                  Batch unfinished ({unfinishedAlbums.length})
                </button>
                <button onClick={() => setMenuOpen(false)} aria-label="Close menu"><Icon name="close" /></button>
              </div>
            </div>
            <div className="rack-shell">
              <aside className="rack-alpha" aria-label="Filter by artist letter">
                {artistLetters.map((letter) => (
                  <button
                    key={letter}
                    className={`alpha-btn ${artistLetterFilter === letter ? "active" : ""}`}
                    onClick={() => setArtistLetterFilter(letter)}
                  >
                    {letter}
                  </button>
                ))}
              </aside>
              <div className="rack-grid">
                {visibleAlbums.map((album) => (
                  <button
                    key={album.id}
                    className={`rack-item ${selectedAlbum?.id === album.id ? "active" : ""}`}
                    onClick={() => void openAlbumWithSequence(album, { animate: true })}
                  >
                    <img src={coverUrl(album.coverArt)} alt={album.name} />
                    <span>{album.name}</span>
                    <small>{album.artist ?? "Unknown artist"}</small>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {coverEditorOpen && selectedAlbum ? (
        <div className="menu-overlay" role="dialog" aria-modal="true">
          <div className="menu-panel cd-editor-panel">
            <div className="menu-head">
              <h2>
                {batchActive ? "Batch: " : ""}
                {coverEditorMode === "back" ? "Set sleeve back" : "Set CD artwork"}: {selectedAlbum.name}
              </h2>
              <div className="menu-actions">
                {batchActive ? (
                  <>
                    <button className="menu-action-btn" onClick={() => void skipBatchItem()}>
                      Skip
                    </button>
                    <button className="menu-action-btn" onClick={() => setBatchActive(false)}>
                      Stop batch
                    </button>
                  </>
                ) : null}
                <button onClick={() => setCoverEditorOpen(false)} aria-label="Close editor"><Icon name="close" /></button>
              </div>
            </div>
            {batchActive ? (
              <p className="batch-note">
                Save stores both CD and Back for this album. Skip leaves this item unchanged and moves on.
              </p>
            ) : null}
            <div className="cd-editor-grid">
              <div className="cd-editor-controls">
                <div className="cover-mode-tabs" role="tablist" aria-label="Cover type">
                  <button
                    className={coverEditorMode === "disc" ? "active" : ""}
                    role="tab"
                    aria-selected={coverEditorMode === "disc"}
                    onClick={() => switchCoverEditorMode("disc")}
                  >
                    CD
                  </button>
                  <button
                    className={coverEditorMode === "back" ? "active" : ""}
                    role="tab"
                    aria-selected={coverEditorMode === "back"}
                    onClick={() => switchCoverEditorMode("back")}
                  >
                    Back
                  </button>
                </div>
                <label>Search Discogs album</label>
                <div className="cd-input-row">
                  <input
                    className="cd-input"
                    value={discogsQuery}
                    onChange={(e) => setDiscogsQuery(e.target.value)}
                    placeholder="Example: Blink-182 Enema Of The State"
                  />
                  <button className="line-btn" onClick={() => void lookupDiscogsByQuery()} disabled={discogsLoading}>
                    {discogsLoading ? "..." : "Search album"}
                  </button>
                </div>
                {discogsResults.length > 0 ? (
                  <div className="discogs-results">
                    {discogsResults.map((r) => (
                      <button
                        key={r.url}
                        className="discogs-result"
                        onClick={() => {
                          const resultImages = r.images ?? [];
                          setCoverSourceInput(resultImages[0] ?? r.url);
                          setDiscogsCandidates(resultImages);
                          if (!resultImages.length) {
                            void lookupDiscogsImages(r.url);
                          }
                        }}
                      >
                        <span>{r.title}</span>
                        {r.artist ? <small>{r.artist}</small> : null}
                        {r.formats?.length ? <small>{r.formats.join(", ")}</small> : null}
                        <small>{r.url}</small>
                      </button>
                    ))}
                  </div>
                ) : null}
                <label>Discogs URL</label>
                <div className="cd-input-row">
                  <input
                    className="cd-input"
                    value={coverSourceInput}
                    onChange={(e) => setCoverSourceInput(e.target.value)}
                    placeholder="https://www.discogs.com/..."
                  />
                  <button className="line-btn" onClick={() => void lookupDiscogsImages()} disabled={discogsLoading}>
                    {discogsLoading ? "..." : "Search"}
                  </button>
                </div>
                <label>Or upload a file</label>
                <input
                  className="cd-input"
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => setCoverSourceInput(typeof reader.result === "string" ? reader.result : "");
                    reader.readAsDataURL(file);
                  }}
                />
                {discogsCandidates.length > 0 ? (
                  <>
                    <label>Choose image ({discogsCandidates.length})</label>
                    <div className="discogs-grid">
                      {discogsCandidates.map((img) => (
                        <button
                          key={img}
                          className={`discogs-item ${coverSourceInput === img ? "active" : ""}`}
                          onClick={() => setCoverSourceInput(img)}
                        >
                          <img src={proxyImageUrl(img)} alt="Discogs candidate" />
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
                {editorError ? <p className="editor-error">{editorError}</p> : null}
                <label>Zoom: {editorZoom.toFixed(2)}</label>
                <input className="slider" type="range" min={0.7} max={1.8} step={0.01} value={editorZoom} onChange={(e) => setEditorZoom(Number(e.target.value))} />
                <label>X: {editorX}px</label>
                <input className="slider" type="range" min={-220} max={220} step={1} value={editorX} onChange={(e) => setEditorX(Number(e.target.value))} />
                <label>Y: {editorY}px</label>
                <input className="slider" type="range" min={-220} max={220} step={1} value={editorY} onChange={(e) => setEditorY(Number(e.target.value))} />
                <label>Rotation: {editorRotate} degrees</label>
                <input className="slider" type="range" min={-180} max={180} step={1} value={editorRotate} onChange={(e) => setEditorRotate(Number(e.target.value))} />
                <div className="cd-editor-actions">
                  <button className="line-btn ghost-line" onClick={() => {
                    setCoverSourceInput("");
                    setEditorZoom(1);
                    setEditorX(0);
                    setEditorY(0);
                    setEditorRotate(0);
                  }}>Reset</button>
                  <button className="line-btn play-line" onClick={saveEditorCover}>Save</button>
                </div>
              </div>
              <div className="cd-editor-preview">
                {coverEditorMode === "back" ? (
                  <div className="back-cover-preview">
                    <div className="back-cover-frame">
                      <img src="/backcover.png" className="back-cover-template" alt="" aria-hidden="true" />
                      <div className="back-cover-inlay-window">
                        <img
                          src={resolveEditorPreviewSource(coverSourceInput)}
                          className="back-cover-inlay"
                          style={{ transform: `translate(${editorX}px, ${editorY}px) scale(${editorZoom}) rotate(${editorRotate}deg)` }}
                          alt="Back cover preview"
                        />
                      </div>
                      <div className="back-center-guides" aria-hidden="true">
                        <span className="guide-h" />
                        <span className="guide-v" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="disc paused">
                    <img
                      src={resolveEditorPreviewSource(coverSourceInput)}
                      className="disc-album-art"
                      style={{ transform: `translate(${editorX}px, ${editorY}px) scale(${editorZoom}) rotate(${editorRotate}deg)` }}
                      alt="CD preview"
                    />
                    <div className="cd-center-guides" aria-hidden="true">
                      <span className="guide-h" />
                      <span className="guide-v" />
                      <span className="guide-ring" />
                      <span className="guide-hole" />
                    </div>
                    <img src="/rand.png" className="disc-center-overlay preview-overlay" alt="" aria-hidden="true" />
                    <img src="/rand2.png" className="disc-center-overlay overlay-top fade-in preview-overlay" alt="" aria-hidden="true" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}
