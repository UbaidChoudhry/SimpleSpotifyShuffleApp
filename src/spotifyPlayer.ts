import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import SpotifyAppRemote from '../modules/spotify-app-remote';
import type { NativePlayerState, RepeatMode } from '../modules/spotify-app-remote';
import { APP_REMOTE_REDIRECT_URI, assertClientIdConfigured, SPOTIFY_CLIENT_ID } from './config';
import { savePlaybackPosition } from './playbackPosition';

const APP_REMOTE_TOKEN_KEY = 'spotify_app_remote_token';
const SPOTIFY_NOT_INSTALLED = 'The Spotify app is required to play music here.';
// Spotify snaps this to its own available sizes; this just requests "large."
const ALBUM_ART_SIZE = 640;
const PLAYLIST_URI_PREFIX = 'spotify:playlist:';

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

/** A snapshot read on demand, carrying the position as of that read. */
export type PlayerReading = PlayerSnapshot & { positionMs: number };

/**
 * How the current connection came about.
 *
 * `resumedSession` means Spotify was already running and kept whatever it was
 * doing; `wokeSpotify` means it was launched by `authorizeAndPlayURI`, which
 * always starts the given playlist at its first track. Only the second case
 * leaves the player somewhere this app chose rather than somewhere the user
 * left it, which is what tells a resume whether it has anything to correct.
 */
export type ConnectionOrigin = 'resumedSession' | 'wokeSpotify';

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
  lastConnectionOrigin: () => ConnectionOrigin | null;
  setShuffleOff: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  resume: () => Promise<void>;
  pause: () => Promise<void>;
  readState: () => Promise<PlayerReading | null>;
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

export function playlistIdFromContextUri(contextUri: string | null): string | null {
  if (contextUri == null || !contextUri.startsWith(PLAYLIST_URI_PREFIX)) return null;
  return contextUri.slice(PLAYLIST_URI_PREFIX.length) || null;
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
  const contextUriRef = useRef<string | null>(null);
  const isPausedRef = useRef(true);
  const connectionOriginRef = useRef<ConnectionOrigin | null>(null);
  // Gates the silent foreground reconnect — only worth attempting if a
  // connection existed at some point this session.
  const hasEverConnectedRef = useRef(false);
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

  /** Where playback is right now, interpolated the same way the progress bar is. */
  const livePositionMs = useCallback(() => {
    const { positionMs: base, at } = positionBaseRef.current;
    const elapsed = isPausedRef.current ? 0 : (Date.now() - at) * playbackSpeedRef.current;
    return Math.max(0, Math.round(Math.min(base + elapsed, durationMsRef.current)));
  }, []);

  // Recorded so a cold start can resume rather than restart — see
  // playbackPosition.ts. Only a playlist context is worth remembering: anything
  // else (an album, a radio session started from Spotify itself) isn't
  // something this app can resume into.
  const persistPosition = useCallback(() => {
    const playlistId = playlistIdFromContextUri(contextUriRef.current);
    const trackUri = trackUriRef.current;
    if (playlistId == null || trackUri == null) return;
    void savePlaybackPosition({ playlistId, trackUri, positionMs: livePositionMs() });
  }, [livePositionMs]);

  const applyPlayerState = useCallback((state: NativePlayerState) => {
    setSnapshot(toPlayerSnapshot(state));
    durationMsRef.current = state.track?.durationMs ?? 0;
    playbackSpeedRef.current = state.playbackSpeed;
    positionBaseRef.current = { positionMs: state.positionMs, at: Date.now() };
    setPositionMs(state.positionMs);
    isPausedRef.current = state.isPaused;
    contextUriRef.current = state.contextUri;
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

    // Every push is a discrete event (track change, pause, resume, seek), so
    // this writes rarely — the 250ms interpolation tick doesn't come through
    // here. Backgrounding persists again, since playback keeps moving after the
    // last push and the app may not get another one before iOS kills it.
    persistPosition();
  }, [persistPosition]);

  useEffect(() => {
    ensureConfigured();

    SpotifyAppRemote.isSpotifyInstalled().then(setSpotifyInstalled);

    const stateSub = SpotifyAppRemote.addListener('onPlayerStateChange', applyPlayerState);
    const connectionSub = SpotifyAppRemote.addListener('onConnectionStateChange', (event) => {
      connectionRef.current = event.state;
      setConnection(event.state);
      if (event.state === 'connected') {
        hasEverConnectedRef.current = true;
        setPlayerError(null);
      }
      // Connection errors are deliberately not surfaced here. Spotify drops the
      // socket routinely — on backgrounding, and after a short idle with
      // playback paused — and showing that as a failure meant a two-second app
      // switch produced "connection terminated". Failures that matter are the
      // ones a user action was waiting on, and those reject playPlaylist's
      // promise instead.
      if (event.error) console.log('[spotify] app remote connection error:', event.error);
    });
    const tokenSub = SpotifyAppRemote.addListener('onAccessToken', (event) => {
      SecureStore.setItemAsync(APP_REMOTE_TOKEN_KEY, event.accessToken);
    });

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        // Last chance to record where playback got to: iOS can kill a
        // backgrounded app without another player-state push ever arriving, and
        // that push is the only other thing that writes this.
        persistPosition();
        return;
      }

      if (connectionRef.current === 'connected') {
        // Position drifts while backgrounded — playback continues in Spotify.
        SpotifyAppRemote.getPlayerState().then((fresh) => {
          if (fresh) applyPlayerState(fresh);
        });
        return;
      }

      // Silently restore a connection Spotify dropped while we were away, so
      // returning to the app doesn't demand a fresh tap on Play. Only attempted
      // if there was a connection to begin with; failure is expected whenever
      // Spotify is fully suspended, and just leaves the Play button showing.
      if (!hasEverConnectedRef.current) return;
      loadToken().then((token) => {
        if (!token) return;
        connectionOriginRef.current = 'resumedSession';
        SpotifyAppRemote.connectWithAccessToken(token).catch(() => {});
      });
    });

    return () => {
      stateSub.remove();
      connectionSub.remove();
      tokenSub.remove();
      appStateSub.remove();
      SpotifyAppRemote.disconnect().catch(() => {});
    };
  }, [applyPlayerState, ensureConfigured, loadToken, persistPosition]);

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
          // Set before awaiting, not after: the connection event reaches JS
          // ahead of this promise resolving, so anything reacting to
          // 'connected' has to be able to read the origin already.
          connectionOriginRef.current = 'resumedSession';
          await SpotifyAppRemote.connectWithAccessToken(token);
          return;
        } catch {
          // Cached token rejected (revoked/expired) — fall through to a fresh
          // app-switch authorization below.
        }
      }

      connectionOriginRef.current = 'wokeSpotify';
      const installed = await SpotifyAppRemote.authorizeAndPlay(uri);
      setSpotifyInstalled(installed);
      if (!installed) {
        setConnection('disconnected');
        setPlayerError(SPOTIFY_NOT_INSTALLED);
      }
    },
    [ensureConfigured, loadToken]
  );

  const lastConnectionOrigin = useCallback(() => connectionOriginRef.current, []);

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

  const resume = useCallback(() => SpotifyAppRemote.resume(), []);

  const pause = useCallback(() => SpotifyAppRemote.pause(), []);

  // Deliberately asks Spotify rather than reading `snapshot`: callers use this
  // right after connecting, when the first state push may not have landed yet
  // and the stored snapshot is still whatever the last session left behind.
  const readState = useCallback(async (): Promise<PlayerReading | null> => {
    const fresh = await SpotifyAppRemote.getPlayerState().catch(() => null);
    if (!fresh) return null;
    applyPlayerState(fresh);
    return { ...toPlayerSnapshot(fresh), positionMs: fresh.positionMs };
  }, [applyPlayerState]);

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
    // Logging out is the one disconnect that should NOT auto-reconnect.
    hasEverConnectedRef.current = false;
    setConnection('disconnected');
    setSnapshot(null);
    trackUriRef.current = null;
    contextUriRef.current = null;
    connectionOriginRef.current = null;
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
    lastConnectionOrigin,
    setShuffleOff,
    togglePlayPause,
    resume,
    pause,
    readState,
    skipNext,
    skipPrevious,
    seekTo,
    toggleLike,
    cycleRepeat,
    disconnect,
  };
}
