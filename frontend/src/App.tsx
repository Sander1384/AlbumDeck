import { useEffect, useMemo, useRef, useState } from "react";
import {
  coverUrl,
  fetchAlbum,
  fetchAlbums,
  fetchCustomDiscCovers,
  deleteCustomDiscCover,
  fetchDiscogsImages,
  proxyImageUrl,
  saveCustomDiscCover,
  saveCustomDiscCovers,
  searchDiscogs,
  streamUrl,
  type Album,
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

type IconName = "menu" | "close" | "prev" | "play" | "pause" | "next" | "sound" | "soundOff" | "fullscreen" | "fullscreenExit" | "cast" | "speed";

function Icon({ name }: { name: IconName }) {
  if (name === "menu") return <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
  if (name === "close") return <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>;
  if (name === "prev") return <svg viewBox="0 0 24 24"><path d="M7 6v12M18 7l-8 5 8 5z" /></svg>;
  if (name === "next") return <svg viewBox="0 0 24 24"><path d="M17 6v12M6 7l8 5-8 5z" /></svg>;
  if (name === "sound") return <svg viewBox="0 0 24 24"><path d="M4 14h4l5 4V6L8 10H4zM17 9a5 5 0 0 1 0 6M19.5 6.5a8.5 8.5 0 0 1 0 11" /></svg>;
  if (name === "soundOff") return <svg viewBox="0 0 24 24"><path d="M4 14h4l5 4V6L8 10H4zM16 9l5 6M21 9l-5 6" /></svg>;
  if (name === "fullscreen") return <svg viewBox="0 0 24 24"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5" /></svg>;
  if (name === "fullscreenExit") return <svg viewBox="0 0 24 24"><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" /></svg>;
  if (name === "cast") return <svg viewBox="0 0 24 24"><path d="M4 6h16v11H4zM4 18h.01M4 14a4 4 0 0 1 4 4M4 10a8 8 0 0 1 8 8" /></svg>;
  if (name === "speed") return <svg viewBox="0 0 24 24"><path d="M12 4a8 8 0 1 0 8 8M12 8v4l3 2M17 4h4v4" /></svg>;
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

type CastWindow = Window & {
  __onGCastApiAvailable?: (isAvailable: boolean) => void;
  cast?: any;
  chrome?: any;
};

const DISC_COVER_STORAGE_KEY = "cd-player-custom-disc-covers-v1";
const LOAD_SOUNDS_STORAGE_KEY = "cd-player-load-sounds-enabled-v1";
const DISC_SPEED_STORAGE_KEY = "albumdeck-disc-speed-v1";
const DISC_SPEED_DEFAULT = 100;
const APP_VERSION = "v0.3.15";

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
  const [isCaseOverlayReady, setIsCaseOverlayReady] = useState(false);
  const [caseOverlaySrc, setCaseOverlaySrc] = useState("/CDALBUM.webp");
  const [isTopArtReady, setIsTopArtReady] = useState(false);
  const [isTopCaseReady, setIsTopCaseReady] = useState(false);
  const [trackListAnim, setTrackListAnim] = useState<"up" | "down" | "">("");
  const [discCoverByAlbum, setDiscCoverByAlbum] = useState<Record<string, CustomDiscCover>>({});
  const [coverEditorOpen, setCoverEditorOpen] = useState(false);
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
  const isTopLayerReady = isCaseOverlayReady && isTopArtReady && isTopCaseReady;
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

  useEffect(() => {
    currentTrackRef.current = currentTrack;
    selectedAlbumRef.current = selectedAlbum;
    currentCoverSrcRef.current = currentCoverSrc;
    isCastingRef.current = isCasting;
  }, [currentTrack, currentCoverSrc, isCasting, selectedAlbum]);

  useEffect(() => {
    setIsTopArtReady(false);
    setIsTopCaseReady(false);
  }, [topCover?.key, currentCoverSrc, selectedAlbum?.id]);

  useEffect(() => {
    const loadCovers = async () => {
      let localParsed: Record<string, CustomDiscCover> = {};
      try {
        const raw = localStorage.getItem(DISC_COVER_STORAGE_KEY);
        if (raw) {
          localParsed = JSON.parse(raw) as Record<string, CustomDiscCover>;
        }
      } catch {
        localParsed = {};
      }

      try {
        const remote = await fetchCustomDiscCovers<Record<string, CustomDiscCover>>();
        const merged = { ...localParsed, ...(remote ?? {}) };
        setDiscCoverByAlbum(merged);
        if (Object.keys(localParsed).length > 0) {
          void saveCustomDiscCovers(merged).catch(() => {
            // keep local fallback
          });
        }
      } catch {
        setDiscCoverByAlbum(localParsed);
      } finally {
        setCoversLoaded(true);
      }
    };
    void loadCovers();
  }, []);

  useEffect(() => {
    if (!coversLoaded) return;
    localStorage.setItem(DISC_COVER_STORAGE_KEY, JSON.stringify(discCoverByAlbum));
  }, [discCoverByAlbum, coversLoaded]);

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
        reject(new Error("Cover laden duurde te lang"));
      }, 10000);
      img.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("Kon cover niet laden"));
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
    const mediaInfo = new win.chrome.cast.media.MediaInfo(absoluteUrl(streamUrl(song.id)), "audio/mpeg");
    mediaInfo.streamType = win.chrome.cast.media.StreamType.BUFFERED;
    if (song.duration) mediaInfo.duration = song.duration;

    const metadata = new win.chrome.cast.media.MusicTrackMediaMetadata();
    metadata.title = cleanTrackTitle(song.title) || song.title || "AlbumDeck";
    metadata.artist = song.artist ?? album?.artist ?? "";
    metadata.albumName = album?.name ?? "";

    const imageSrc = currentCoverSrcRef.current ?? coverUrl(album?.coverArt);
    if (imageSrc) {
      metadata.images = [new win.chrome.cast.Image(absoluteUrl(imageSrc))];
    }

    mediaInfo.metadata = metadata;

    const request = new win.chrome.cast.media.LoadRequest(mediaInfo);
    request.autoplay = true;
    await session.loadMedia(request);
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
      const fail = (err: unknown) => reject(err instanceof Error ? err : new Error("Cast bediening mislukt"));
      if (isRemotePlaying) media.pause(null, done, fail);
      else media.play(null, done, fail);
    });
    setIsPlaying(!isRemotePlaying);
  };

  const requestCastSession = async () => {
    const win = window as CastWindow;
    if (!window.isSecureContext) {
      setError("Cast werkt niet vanaf HTTP. Open AlbumDeck via HTTPS op een hostnaam die je Chromecast ook kan bereiken.");
      return;
    }

    if (!win.cast?.framework || !win.chrome?.cast) {
      setError("Cast is niet beschikbaar in deze browser. Gebruik Chrome/Chromium, HTTPS en hetzelfde netwerk als je Chromecast.");
      return;
    }

    try {
      const context = win.cast.framework.CastContext.getInstance();
      const session = context.getCurrentSession() ?? await context.requestSession();
      castSessionRef.current = session;
      setIsCasting(Boolean(session));
      audioRef.current?.pause();

      const song = currentTrackRef.current;
      if (song) await loadCastMedia(song);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e ?? "");
      if (!message.includes("cancel")) {
        setError(message || "Cast starten mislukt");
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

  const openAlbumWithSequence = async (album: Album, opts?: { animate?: boolean }) => {
    const animate = opts?.animate ?? true;
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
        setSelectedAlbum(album);
        setTracks(songs);
        setTrackIndex(0);
        setCurrentCoverSrc(normalizedCover);
        placeCoverOnStack(normalizedCover);
        setIsDiscFlipped(false);
        setIsFastSpin(false);
        setIsTrayClosing(false);
        await playTrackImmediate(firstSong);
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
        setError(e instanceof Error ? e.message : "Kon album niet openen");
      }
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const loaded = await fetchAlbums();
        setAlbums(loaded);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Kon albums niet laden");
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
    overlay.onload = () => setIsCaseOverlayReady(true);
    overlay.onerror = () => {
      setCaseOverlaySrc("/CDHOES4.png");
      const fallback = new Image();
      fallback.onload = () => setIsCaseOverlayReady(true);
      fallback.onerror = () => setIsCaseOverlayReady(true);
      fallback.src = "/CDHOES4.png";
    };
    overlay.src = "/CDALBUM.webp";

    return () => {
      stopFadeTimer();
      clearCoverTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let disposed = false;
    const win = window as CastWindow;

    const initializeCast = (isAvailable: boolean) => {
      if (disposed || !isAvailable || !win.cast?.framework || !win.chrome?.cast) return;

      const context = win.cast.framework.CastContext.getInstance();
      context.setOptions({
        receiverApplicationId: win.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: win.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
      });

      setIsCastReady(true);
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
          if (song) void loadCastMedia(song).catch((e) => setError(e instanceof Error ? e.message : "Cast laden mislukt"));
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
      setError(e instanceof Error ? e.message : "Fullscreen niet beschikbaar");
    }
  };

  const art = topCover?.src ?? currentCoverSrc ?? coverUrl(selectedAlbum?.coverArt);
  const hasDiscArt = Boolean(topCover || selectedAlbum);
  const discSource = currentCustomDisc ? resolveEditorPreviewSource(currentCustomDisc.source) : art;
  const discArtStyle = currentCustomDisc
    ? {
        transform: `translate(${currentCustomDisc.x}px, ${currentCustomDisc.y}px) scale(${currentCustomDisc.zoom}) rotate(${currentCustomDisc.rotate}deg)`
      }
    : undefined;

  const openCoverEditor = () => {
    if (!selectedAlbum) return;
    const c = discCoverByAlbum[selectedAlbum.id];
    setCoverSourceInput(c?.source ?? "");
    setEditorZoom(c?.zoom ?? 1);
    setEditorX(c?.x ?? 0);
    setEditorY(c?.y ?? 0);
    setEditorRotate(c?.rotate ?? 0);
    setDiscogsCandidates([]);
    setDiscogsQuery(selectedAlbum.name);
    setDiscogsResults([]);
    setEditorError(null);
    setCoverEditorOpen(true);
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
    const src = coverSourceInput.trim();
    if (!src) {
      setDiscCoverByAlbum((prev) => {
        const next = { ...prev };
        delete next[albumId];
        return next;
      });
      void deleteCustomDiscCover(albumId).catch((e) => {
        setError(e instanceof Error ? e.message : "CD-cover verwijderen mislukt");
      });
      setCoverEditorOpen(false);
      return;
    }
    const cover = {
      source: src,
      zoom: editorZoom,
      x: editorX,
      y: editorY,
      rotate: editorRotate
    };
    setDiscCoverByAlbum((prev) => ({
      ...prev,
      [albumId]: cover
    }));
    void saveCustomDiscCover(albumId, cover).catch((e) => {
      setError(e instanceof Error ? e.message : "CD-cover opslaan mislukt");
    });
    setCoverEditorOpen(false);
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
        setEditorError("Geen afbeeldingen gevonden op deze Discogs pagina.");
      }
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : "Discogs lookup mislukt");
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
        setEditorError("Geen Discogs resultaten gevonden.");
      }
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : "Discogs zoeken mislukt");
    } finally {
      setDiscogsLoading(false);
    }
  };

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
      <div className="build-badge" aria-label={`AlbumDeck versie ${APP_VERSION}`}>{APP_VERSION}</div>

      <section className="stage">
        <div className="stage-cover">
          <div className="jewel-case">
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
            {topCover ? (
              <div
                key={topCover.key}
                className={`stack-card stack-top ${isCoverInsert ? "insert" : ""}`}
                style={{ ["--tilt" as string]: `${topCover.angle}deg`, visibility: isTopLayerReady ? "visible" : "hidden" }}
              >
                <img src={topCover.src} className="stack-art" alt={selectedAlbum?.name ?? "Album cover"} onLoad={() => setIsTopArtReady(true)} />
                <img src={caseOverlaySrc} className="stack-case-overlay" alt="" aria-hidden="true" onLoad={() => setIsTopCaseReady(true)} />
              </div>
            ) : selectedAlbum ? (
              <div className="stack-card stack-top" style={{ ["--tilt" as string]: "0deg", visibility: isTopLayerReady ? "visible" : "hidden" }}>
                <img src={currentCoverSrc ?? coverUrl(selectedAlbum.coverArt)} className="stack-art" alt={selectedAlbum.name} onLoad={() => setIsTopArtReady(true)} />
                <img src={caseOverlaySrc} className="stack-case-overlay" alt="" aria-hidden="true" onLoad={() => setIsTopCaseReady(true)} />
              </div>
            ) : (
              <div className="cover-empty" aria-label="No album selected">
                <div className="empty-brand">
                  <span>Kies een album in het menu</span>
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
            <button className="line-btn" onClick={() => void prev()} aria-label="Previous"><Icon name="prev" /></button>
            <button className="line-btn play-line" onClick={() => void togglePlay()} aria-label="Play Pause"><Icon name={isPlaying ? "pause" : "play"} /></button>
            <button className="line-btn" onClick={() => void next()} aria-label="Next"><Icon name="next" /></button>
            <button className="line-btn ghost-line" onClick={() => setMenuOpen(true)} aria-label="Open album menu"><Icon name="menu" /></button>
            <button className="line-btn ghost-line" onClick={openCoverEditor} aria-label="Set CD cover">CD</button>
            <div className="speed-control">
              <button
                className={`line-btn ghost-line ${speedPanelOpen ? "active-line" : ""}`}
                onClick={() => setSpeedPanelOpen((open) => !open)}
                aria-label="CD snelheid aanpassen"
                aria-expanded={speedPanelOpen}
                title="CD snelheid aanpassen"
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
                    aria-label="CD draaisnelheid"
                    title={`CD snelheid ${discSpeed}%`}
                  />
                </div>
              ) : null}
            </div>
            <button
              className={`line-btn ghost-line cast-btn ${isCasting ? "casting" : ""}`}
              onClick={() => void requestCastSession()}
              aria-label="Cast naar Chromecast"
              title={isCastReady ? "Cast naar Chromecast" : "Cast niet beschikbaar"}
            >
              <Icon name="cast" />
            </button>
            <button
              className="line-btn ghost-line"
              onClick={() => setLoadSoundsEnabled((v) => !v)}
              aria-label={loadSoundsEnabled ? "Disable load sounds" : "Enable load sounds"}
              title={loadSoundsEnabled ? "Laadgeluiden aan" : "Laadgeluiden uit"}
            >
              <Icon name={loadSoundsEnabled ? "sound" : "soundOff"} />
            </button>
            <button
              className="line-btn ghost-line"
              onClick={() => void toggleFullscreen()}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title={isFullscreen ? "Volledig scherm uit" : "Volledig scherm"}
            >
              <Icon name={isFullscreen ? "fullscreenExit" : "fullscreen"} />
            </button>
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
              <button onClick={() => setMenuOpen(false)} aria-label="Close menu"><Icon name="close" /></button>
            </div>
            <div className="rack-shell">
              <aside className="rack-alpha" aria-label="Filter op artiestletter">
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
              <h2>CD Cover Instellen: {selectedAlbum.name}</h2>
              <button onClick={() => setCoverEditorOpen(false)} aria-label="Close editor"><Icon name="close" /></button>
            </div>
            <div className="cd-editor-grid">
              <div className="cd-editor-controls">
                <label>Zoek album op Discogs</label>
                <div className="cd-input-row">
                  <input
                    className="cd-input"
                    value={discogsQuery}
                    onChange={(e) => setDiscogsQuery(e.target.value)}
                    placeholder="Bijv. Blink-182 Enema Of The State"
                  />
                  <button className="line-btn" onClick={() => void lookupDiscogsByQuery()} disabled={discogsLoading}>
                    {discogsLoading ? "..." : "Zoek album"}
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
                    {discogsLoading ? "..." : "Zoek"}
                  </button>
                </div>
                <label>Of upload bestand</label>
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
                    <label>Kies afbeelding ({discogsCandidates.length})</label>
                    <div className="discogs-grid">
                      {discogsCandidates.map((img) => (
                        <button
                          key={img}
                          className={`discogs-item ${coverSourceInput === img ? "active" : ""}`}
                          onClick={() => setCoverSourceInput(img)}
                        >
                          <img src={proxyImageUrl(img)} alt="Discogs kandidaat" />
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
                <label>Rotatie: {editorRotate}°</label>
                <input className="slider" type="range" min={-180} max={180} step={1} value={editorRotate} onChange={(e) => setEditorRotate(Number(e.target.value))} />
                <div className="cd-editor-actions">
                  <button className="line-btn ghost-line" onClick={() => {
                    setCoverSourceInput("");
                    setEditorZoom(1);
                    setEditorX(0);
                    setEditorY(0);
                    setEditorRotate(0);
                  }}>Reset</button>
                  <button className="line-btn play-line" onClick={saveEditorCover}>Opslaan</button>
                </div>
              </div>
              <div className="cd-editor-preview">
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
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}
