import { useEffect, useState } from 'react';
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

type Status =
  | { kind: 'checking' }
  | { kind: 'loggedOut' }
  | { kind: 'busy'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'idle'; playlistId: string | null; trackCount: number | null; notice?: string };

export default function App() {
  const [status, setStatus] = useState<Status>({ kind: 'checking' });
  const player = useSpotifyPlayer();

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

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {status.kind === 'idle' && status.playlistId != null ? (
        <NowPlayingScreen
          player={player}
          playlistId={status.playlistId}
          trackCount={status.trackCount}
          notice={status.notice ?? null}
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
