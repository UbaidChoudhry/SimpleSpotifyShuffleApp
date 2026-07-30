import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import SpotifyAppRemote from '../modules/spotify-app-remote';
import type { NativePlayerState, RepeatMode } from '../modules/spotify-app-remote';
import { APP_REMOTE_REDIRECT_URI, assertClientIdConfigured, SPOTIFY_CLIENT_ID } from './config';

const APP_REMOTE_TOKEN_KEY = 'spotify_app_remote_token';
const SPOTIFY_NOT_INSTALLED = 'The Spotify app is required to play music here.';
// Spotify snaps this to its own available sizes; this just requests "large."
const ALBUM_ART_SIZE = 640;

// off -> context (repeat the whole playlist) -> track (repeat one song) -> off,
// matching Spotify's own client's cycle order.
const NEXT_REPEAT_MODE: Record<RepeatMode, RepeatMode> = {
  off: 'context',
  context: 'track',
  track: 'off',
};

export async function clearAppRemoteToken(): Promise<void> {
  await SecureStore.deleteItemAsync(APP_REMOTE_TOKEN_KEY);
}

export type PlayerTrack = {
  uri: string;
  name: string;
  artistName: string;
  albumName: string;
  durationMs: number;
  isAdvertisement: boolean;
};

export type PlayerSnapshot = {
  track: PlayerTrack | null;
  isPaused: boolean;
  contextUri: string | null;
  repeatMode: RepeatMode;
};

export type PlayerConnection = 'disconnected' | 'connecting' | 'connected';

export type SpotifyPlayer = {
  connection: PlayerConnection;
  snapshot: PlayerSnapshot | null;
  positionMs: number;
  durationMs: number;
  spotifyInstalled: boolean | null;
  playerError: string | null;
  isTrackSaved: boolean;
  albumArtUri: string | null;
  playPlaylist: (playlistId: string) => Promise<void>;
  setShuffleOff: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  pause: () => Promise<void>;
  skipNext: () => Promise<void>;
  skipPrevious: () => Promise<void>;
  seekTo: (positionMs: number) => Promise<void>;
  toggleLike: () => Promise<void>;
  cycleRepeat: () => Promise<void>;
  disconnect: () => Promise<void>;
};

function toPlayerSnapshot(state: NativePlayerState): PlayerSnapshot {
  return {
    track: state.track,
    isPaused: state.isPaused,
    contextUri: state.contextUri,
    repeatMode: state.repeatMode,
  };
}

export function useSpotifyPlayer(): SpotifyPlayer {
  const [connection, setConnection] = useState<PlayerConnection>('disconnected');
  const [snapshot, setSnapshot] = useState<PlayerSnapshot | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [spotifyInstalled, setSpotifyInstalled] = useState<boolean | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [isTrackSaved, setIsTrackSaved] = useState(false);
  const [albumArtUri, setAlbumArtUri] = useState<string | null>(null);

  // Mirrors the state above for use inside async callbacks and the interval
  // tick, where a stale closure over useState values would otherwise read
  // the value from whenever the callback was created rather than "now."
  const connectionRef = useRef<PlayerConnection>('disconnected');
  const durationMsRef = useRef(0);
  const playbackSpeedRef = useRef(1);
  const positionBaseRef = useRef({ positionMs: 0, at: Date.now() });
  const configuredRef = useRef(false);
  const trackUriRef = useRef<string | null>(null);
  const isTrackSavedRef = useRef(false);
  // Keyed by track URI so revisiting a track (replay, skip-back) doesn't
  // re-fetch art already pulled this session.
  const albumArtCacheRef = useRef<Map<string, string>>(new Map());

  const ensureConfigured = useCallback(() => {
    if (configuredRef.current) return;
    assertClientIdConfigured();
    SpotifyAppRemote.configure(SPOTIFY_CLIENT_ID, APP_REMOTE_REDIRECT_URI);
    configuredRef.current = true;
  }, []);

  const loadToken = useCallback(() => SecureStore.getItemAsync(APP_REMOTE_TOKEN_KEY), []);

  const applyPlayerState = useCallback((state: NativePlayerState) => {
    setSnapshot(toPlayerSnapshot(state));
    durationMsRef.current = state.track?.durationMs ?? 0;
    playbackSpeedRef.current = state.playbackSpeed;
    positionBaseRef.current = { positionMs: state.positionMs, at: Date.now() };
    setPositionMs(state.positionMs);
    isTrackSavedRef.current = state.track?.isSaved ?? false;
    setIsTrackSaved(isTrackSavedRef.current);

    // State pushes fire on every pause/resume/seek, not just track changes —
    // only touch art (and only hit the SDK) when the track actually changed.
    const nextUri = state.track?.uri ?? null;
    if (nextUri !== trackUriRef.current) {
      trackUriRef.current = nextUri;
      const cached = nextUri ? albumArtCacheRef.current.get(nextUri) : undefined;
      setAlbumArtUri(cached ?? null);
      if (nextUri && !cached) {
        SpotifyAppRemote.fetchAlbumArt(ALBUM_ART_SIZE, ALBUM_ART_SIZE)
          .then((uri) => {
            // The track may have changed again before this resolved — don't
            // let a slow, stale fetch clobber whatever's showing now.
            if (uri && trackUriRef.current === nextUri) {
              albumArtCacheRef.current.set(nextUri, uri);
              setAlbumArtUri(uri);
            }
          })
          .catch(() => {});
      }
    }
  }, []);

  useEffect(() => {
    ensureConfigured();

    SpotifyAppRemote.isSpotifyInstalled().then(setSpotifyInstalled);

    const stateSub = SpotifyAppRemote.addListener('onPlayerStateChange', applyPlayerState);
    const connectionSub = SpotifyAppRemote.addListener('onConnectionStateChange', (event) => {
      connectionRef.current = event.state;
      setConnection(event.state);
      if (event.error) setPlayerError(event.error);
    });
    const tokenSub = SpotifyAppRemote.addListener('onAccessToken', (event) => {
      SecureStore.setItemAsync(APP_REMOTE_TOKEN_KEY, event.accessToken);
    });

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || connectionRef.current !== 'connected') return;
      SpotifyAppRemote.getPlayerState().then((fresh) => {
        if (fresh) applyPlayerState(fresh);
      });
    });

    return () => {
      stateSub.remove();
      connectionSub.remove();
      tokenSub.remove();
      appStateSub.remove();
      SpotifyAppRemote.disconnect().catch(() => {});
    };
  }, [applyPlayerState, ensureConfigured]);

  // The SDK only pushes position on discrete state changes, so the bar
  // interpolates between pushes rather than sitting still until the next one.
  useEffect(() => {
    if (connection !== 'connected' || snapshot?.isPaused) return;

    const tick = setInterval(() => {
      const { positionMs: base, at } = positionBaseRef.current;
      const elapsed = (Date.now() - at) * playbackSpeedRef.current;
      setPositionMs(Math.min(base + elapsed, durationMsRef.current));
    }, 250);

    return () => clearInterval(tick);
  }, [connection, snapshot?.isPaused]);

  const playPlaylist = useCallback(
    async (playlistId: string) => {
      ensureConfigured();
      setPlayerError(null);
      const uri = `spotify:playlist:${playlistId}`;

      if (connectionRef.current === 'connected') {
        await SpotifyAppRemote.setShuffle(false);
        await SpotifyAppRemote.play(uri);
        return;
      }

      setConnection('connecting');
      const token = await loadToken();
      if (token) {
        try {
          await SpotifyAppRemote.connectWithAccessToken(token);
          return;
        } catch {
          // Cached token rejected (revoked/expired) — fall through to a fresh
          // app-switch authorization below.
        }
      }

      const installed = await SpotifyAppRemote.authorizeAndPlay(uri);
      setSpotifyInstalled(installed);
      if (!installed) {
        setConnection('disconnected');
        setPlayerError(SPOTIFY_NOT_INSTALLED);
      }
    },
    [ensureConfigured, loadToken]
  );

  // Restarting after a reshuffle is NOT done here — see startPlaylistFromTop
  // in spotifyApi.ts for why it has to bypass the local Spotify app. This
  // only re-asserts the app's core invariant (Spotify's own shuffle stays
  // off, since the randomness already lives in the playlist order).
  const setShuffleOff = useCallback(async () => {
    setPlayerError(null);
    await SpotifyAppRemote.setShuffle(false);
  }, []);

  const togglePlayPause = useCallback(async () => {
    if (snapshot?.isPaused) {
      await SpotifyAppRemote.resume();
    } else {
      await SpotifyAppRemote.pause();
    }
  }, [snapshot?.isPaused]);

  const pause = useCallback(() => SpotifyAppRemote.pause(), []);

  const skipNext = useCallback(() => SpotifyAppRemote.skipNext(), []);
  const skipPrevious = useCallback(() => SpotifyAppRemote.skipPrevious(), []);
  const seekTo = useCallback((ms: number) => {
    positionBaseRef.current = { positionMs: ms, at: Date.now() };
    setPositionMs(ms);
    return SpotifyAppRemote.seekTo(ms);
  }, []);

  const toggleLike = useCallback(async () => {
    const uri = trackUriRef.current;
    if (!uri) return;
    // Optimistic — addToLibrary/removeFromLibrary don't trigger a player-state
    // push (that's the playerAPI's subscription, this is the separate userAPI),
    // so without this the heart wouldn't update until the track next changes.
    const wasSaved = isTrackSavedRef.current;
    isTrackSavedRef.current = !wasSaved;
    setIsTrackSaved(!wasSaved);
    try {
      const result = wasSaved
        ? await SpotifyAppRemote.removeFromLibrary(uri)
        : await SpotifyAppRemote.addToLibrary(uri);
      if (result && result.uri === trackUriRef.current) {
        isTrackSavedRef.current = result.isAdded;
        setIsTrackSaved(result.isAdded);
      }
    } catch {
      isTrackSavedRef.current = wasSaved;
      setIsTrackSaved(wasSaved);
    }
  }, []);

  const cycleRepeat = useCallback(async () => {
    const current = snapshot?.repeatMode ?? 'off';
    await SpotifyAppRemote.setRepeatMode(NEXT_REPEAT_MODE[current]);
  }, [snapshot?.repeatMode]);

  // The hook itself stays mounted across a log out (App() renders it
  // unconditionally), so the SDK connection must be torn down explicitly
  // rather than relying on the unmount cleanup, which won't fire here.
  const disconnect = useCallback(async () => {
    await SpotifyAppRemote.disconnect().catch(() => {});
    connectionRef.current = 'disconnected';
    setConnection('disconnected');
    setSnapshot(null);
    trackUriRef.current = null;
    albumArtCacheRef.current.clear();
    setAlbumArtUri(null);
  }, []);

  return {
    connection,
    snapshot,
    positionMs,
    durationMs: durationMsRef.current,
    spotifyInstalled,
    playerError,
    isTrackSaved,
    albumArtUri,
    playPlaylist,
    setShuffleOff,
    togglePlayPause,
    pause,
    skipNext,
    skipPrevious,
    seekTo,
    toggleLike,
    cycleRepeat,
    disconnect,
  };
}
