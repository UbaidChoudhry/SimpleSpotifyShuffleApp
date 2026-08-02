import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { clearTokens, isLoggedIn, login } from './src/auth';
import { clearCurrentPlaylistId, loadCurrentPlaylistId } from './src/currentPlaylist';
import { clearLikedSongsCache } from './src/likedSongsCache';
import { NowPlayingScreen } from './src/NowPlayingScreen';
import { NoActiveDeviceError, shuffleLikedSongsIntoPlaylist, startPlaylistFromTop } from './src/spotifyApi';
import { useSpotifyPlayer } from './src/spotifyPlayer';

WebBrowser.maybeCompleteAuthSession();

const CACHE_CLEARED_NOTICE = 'Cached library cleared. The next shuffle will do a full resync.';

// A Spotify that was just woken is still bringing playback back up, so its
// first reported state can be empty for a moment. Taking that at face value
// would start the playlist over the top of the song it was about to resume, so
// a wake gets a few tries before "nothing playing" is believed.
const WAKE_SETTLE_ATTEMPTS = 6;
const WAKE_SETTLE_INTERVAL_MS = 400;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Status =
  | { kind: 'checking' }
  | { kind: 'loggedOut' }
  | { kind: 'busy'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'idle'; playlistId: string | null; trackCount: number | null; notice?: string };

export default function App() {
  const [status, setStatus] = useState<Status>({ kind: 'checking' });
  const player = useSpotifyPlayer();
  // The playlist a tap on Play should fall back to, held while App Remote
  // connects. The connection lands asynchronously, well after playPlaylist
  // resolves, so the work that needs a live connection — deciding whether
  // Spotify already has something to pick up — is deferred to the effect below.
  const pendingPlayRef = useRef<string | null>(null);

  useEffect(() => {
    isLoggedIn()
      .then(async (loggedIn) => {
        if (!loggedIn) {
          setStatus({ kind: 'loggedOut' });
          return;
        }
        // Deliberately local-only: reading the remembered playlist ID is a file
        // read, not a network call. Launch must never depend on Spotify being
        // reachable or unthrottled — a rate-limited lookup here left the app
        // frozen on the loading spinner with no way out.
        const playlistId = await loadCurrentPlaylistId();
        setStatus({ kind: 'idle', playlistId, trackCount: null });
      })
      .catch(() => {
        // Never leave the UI stuck in 'checking' — shuffling still works from
        // the idle state even if this failed.
        setStatus({ kind: 'idle', playlistId: null, trackCount: null });
      });
  }, []);

  /**
   * Gets music going without disturbing what Spotify is already on.
   *
   * Whatever the Spotify app still has loaded — playing or paused, this
   * playlist or something else entirely — is the user's current place, so it is
   * picked up as-is. The shuffle playlist is only started when Spotify has
   * nothing loaded at all.
   *
   * Only ever called with a live App Remote connection: reading Spotify's state
   * is the whole point, and there is nothing to read until one exists. Pass
   * `justWoken` when that connection came from waking Spotify, which reports an
   * empty player for a moment while playback comes back up.
   */
  const startPlayback = async (playlistId: string, justWoken: boolean) => {
    const attempts = justWoken ? WAKE_SETTLE_ATTEMPTS : 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await delay(WAKE_SETTLE_INTERVAL_MS);
      const state = await player.readState();
      // A null reading is a failed read, not an empty player — either way it
      // says nothing about what Spotify has loaded, and starting the playlist
      // on the strength of it would wipe out the very thing being protected.
      if (state?.track == null) continue;
      if (state.isPaused) await player.resume();
      return;
    }

    await player.playPlaylist(playlistId);
  };

  const handlePlay = async (playlistId: string) => {
    if (player.connection === 'connected') {
      await startPlayback(playlistId, false);
      return;
    }

    // Not connected yet, so there is no state to read. connectOrWake attaches
    // to a running Spotify without touching playback, and wakes a suspended one
    // onto the user's own last song rather than onto this playlist — either way
    // it lands on something of the user's, which the effect below then reads
    // back. Only if that read comes up genuinely empty does the playlist start.
    pendingPlayRef.current = playlistId;
    try {
      await player.connectOrWake();
    } catch (err) {
      pendingPlayRef.current = null;
      console.log('[spotify] could not start playback:', err instanceof Error ? err.message : err);
    }
  };

  useEffect(() => {
    if (player.connection !== 'connected') return;
    const pendingPlaylistId = pendingPlayRef.current;
    if (pendingPlaylistId == null) return;
    pendingPlayRef.current = null;
    startPlayback(pendingPlaylistId, player.lastConnectionOrigin() === 'wokeSpotify').catch((err) => {
      // Deliberately not surfaced as an error state: that would tear down the
      // now-playing screen over a failure the user can retry by tapping Play.
      console.log('[spotify] could not start playback:', err instanceof Error ? err.message : err);
    });
  }, [player.connection]);

  const handleShuffle = async () => {
    // Playback must be repointed at the new playlist whenever Spotify is
    // connected, not only when a track is actively playing. Spotify holds a
    // queue built from the old order in both cases, so gating this on "was
    // playing" meant a reshuffle from paused rewrote everything and then left
    // the next tap on Play resuming the pre-shuffle playlist.
    //
    // Consequence: reshuffling while paused starts playback. Spotify offers no
    // way to load a context without playing it, and the alternative — play then
    // immediately pause — races two independent commands, with the losing
    // branch leaving the phone playing and no pause on the way.
    const isConnected = player.connection === 'connected';
    // Pause immediately, before the rewrite starts (which takes several
    // seconds) rather than only once it's done — the old track shouldn't
    // keep playing while the new order is being built. This also avoids a
    // real bug: Spotify ignores play() on a context it thinks is already
    // playing, so without pausing first, restarting afterward was a no-op.
    if (isConnected && player.snapshot?.isPaused === false) {
      await player.pause();
    }
    try {
      const result = await shuffleLikedSongsIntoPlaylist((message) => setStatus({ kind: 'busy', message }));
      setStatus({ kind: 'idle', playlistId: result.playlistId, trackCount: result.trackCount });
      if (isConnected) {
        await player.setShuffleOff();
        try {
          await startPlaylistFromTop(result.playlistId);
        } catch (err) {
          // Server-side playback needs a device Spotify still counts as active,
          // and a session left paused for a few minutes stops being one — which
          // is exactly the state this branch now has to serve. App Remote can
          // wake the local app back up, so fall back to it rather than
          // dead-ending on an error the user can't act on.
          if (!(err instanceof NoActiveDeviceError)) throw err;
          await player.playPlaylist(result.playlistId);
        }
      }
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Shuffle failed.' });
    }
  };

  const handleConnect = async () => {
    setStatus({ kind: 'busy', message: 'Connecting to Spotify...' });
    try {
      await login();
      setStatus({ kind: 'idle', playlistId: null, trackCount: null });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Login failed.' });
    }
  };

  const handleClearCache = async () => {
    await clearLikedSongsCache();
    // Reachable from the error state too, so drop back to idle either way — that
    // leaves the user on a clean "Shuffle Now" that will rebuild from scratch.
    setStatus((current) =>
      current.kind === 'idle'
        ? { ...current, notice: CACHE_CLEARED_NOTICE }
        : { kind: 'idle', playlistId: null, trackCount: null, notice: CACHE_CLEARED_NOTICE }
    );
  };

  const handleLogOut = async () => {
    await player.disconnect();
    // Otherwise the next account inherits a pointer to a playlist it doesn't own.
    await clearCurrentPlaylistId();
    await clearTokens();
    setStatus({ kind: 'loggedOut' });
  };

  // Held in a local const so the narrowing below survives into onPlay's closure.
  const idlePlaylistId = status.kind === 'idle' ? status.playlistId : null;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {status.kind === 'idle' && idlePlaylistId != null ? (
        <NowPlayingScreen
          player={player}
          playlistId={idlePlaylistId}
          trackCount={status.trackCount}
          notice={status.notice ?? null}
          onPlay={() => void handlePlay(idlePlaylistId)}
          onReshuffle={handleShuffle}
          onClearCache={handleClearCache}
          onLogOut={handleLogOut}
        />
      ) : (
        <SafeAreaView style={styles.container}>
          <Text style={styles.title}>Pure Shuffle</Text>
          <Text style={styles.subtitle}>A truly random shuffle of your Liked Songs</Text>

          {status.kind === 'checking' && <ActivityIndicator color="#1DB954" style={styles.spacerTop} />}

          {status.kind === 'loggedOut' && (
            <TouchableOpacity style={[styles.button, styles.spacerTop]} onPress={handleConnect}>
              <Text style={styles.buttonText}>Connect Spotify</Text>
            </TouchableOpacity>
          )}

          {status.kind === 'busy' && (
            <>
              <ActivityIndicator color="#1DB954" style={styles.spacerTop} />
              <Text style={styles.status}>{status.message}</Text>
            </>
          )}

          {status.kind === 'error' && (
            <>
              <Text style={[styles.error, styles.spacerTop]}>{status.message}</Text>
              <TouchableOpacity style={styles.button} onPress={handleShuffle}>
                <Text style={styles.buttonText}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.clearCacheButton} onPress={handleClearCache}>
                <Text style={styles.clearCacheText}>Clear cached library</Text>
              </TouchableOpacity>
            </>
          )}

          {status.kind === 'idle' && (
            // playlistId == null here — a fresh login with nothing shuffled yet.
            <TouchableOpacity style={[styles.button, styles.spacerTop]} onPress={handleShuffle}>
              <Text style={styles.buttonText}>Shuffle Now</Text>
            </TouchableOpacity>
          )}
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#08090c', alignItems: 'center', paddingTop: 80, paddingHorizontal: 24 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#84868c', fontSize: 14, marginTop: 8, textAlign: 'center' },
  spacerTop: { marginTop: 60 },
  button: { backgroundColor: '#1DB954', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 30 },
  buttonText: { color: '#000', fontSize: 16, fontWeight: '700' },
  status: { color: '#fff', fontSize: 14, marginTop: 16, textAlign: 'center' },
  error: { color: '#f15e6c', fontSize: 14, marginBottom: 16, textAlign: 'center' },
  clearCacheButton: {
    marginTop: 28,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  clearCacheText: { color: '#84868c', fontSize: 13, fontWeight: '600' },
});
