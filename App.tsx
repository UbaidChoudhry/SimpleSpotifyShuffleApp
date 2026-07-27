import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { clearTokens, isLoggedIn, login } from './src/auth';
import { clearLikedSongsCache } from './src/likedSongsCache';
import { shuffleLikedSongsIntoPlaylist } from './src/spotifyApi';

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

  useEffect(() => {
    isLoggedIn().then((loggedIn) => {
      setStatus(loggedIn ? { kind: 'idle', playlistId: null, trackCount: null } : { kind: 'loggedOut' });
    });
  }, []);

  const handleConnect = async () => {
    setStatus({ kind: 'busy', message: 'Connecting to Spotify...' });
    try {
      await login();
      setStatus({ kind: 'idle', playlistId: null, trackCount: null });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Login failed.' });
    }
  };

  const handleShuffle = async () => {
    try {
      const result = await shuffleLikedSongsIntoPlaylist((message) => setStatus({ kind: 'busy', message }));
      setStatus({ kind: 'idle', playlistId: result.playlistId, trackCount: result.trackCount });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Shuffle failed.' });
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
    await clearTokens();
    setStatus({ kind: 'loggedOut' });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <Text style={styles.title}>Pure Shuffle</Text>
      <Text style={styles.subtitle}>A truly random shuffle of your Liked Songs</Text>

      <View style={styles.content}>
        {status.kind === 'checking' && <ActivityIndicator color="#1DB954" />}

        {status.kind === 'loggedOut' && (
          <TouchableOpacity style={styles.button} onPress={handleConnect}>
            <Text style={styles.buttonText}>Connect Spotify</Text>
          </TouchableOpacity>
        )}

        {status.kind === 'busy' && (
          <>
            <ActivityIndicator color="#1DB954" />
            <Text style={styles.status}>{status.message}</Text>
          </>
        )}

        {status.kind === 'error' && (
          <>
            <Text style={styles.error}>{status.message}</Text>
            <TouchableOpacity style={styles.button} onPress={handleShuffle}>
              <Text style={styles.buttonText}>Try Again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.clearCacheButton} onPress={handleClearCache}>
              <Text style={styles.clearCacheText}>Clear cached library</Text>
            </TouchableOpacity>
          </>
        )}

        {status.kind === 'idle' && (
          <>
            <TouchableOpacity style={styles.button} onPress={handleShuffle}>
              <Text style={styles.buttonText}>Shuffle Now</Text>
            </TouchableOpacity>

            {status.trackCount != null && (
              <Text style={styles.status}>Shuffled {status.trackCount} songs into "Pure Shuffle"</Text>
            )}

            {status.notice != null && <Text style={styles.notice}>{status.notice}</Text>}

            {status.playlistId != null && (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => Linking.openURL(`spotify:playlist:${status.playlistId}`)}
              >
                <Text style={styles.secondaryButtonText}>Open in Spotify</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.clearCacheButton} onPress={handleClearCache}>
              <Text style={styles.clearCacheText}>Clear cached library</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.logOutButton} onPress={handleLogOut}>
              <Text style={styles.logOutText}>Log out</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', alignItems: 'center', paddingTop: 80, paddingHorizontal: 24 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#b3b3b3', fontSize: 14, marginTop: 8, textAlign: 'center' },
  content: { marginTop: 60, alignItems: 'center', width: '100%' },
  button: { backgroundColor: '#1DB954', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 30 },
  buttonText: { color: '#000', fontSize: 16, fontWeight: '700' },
  secondaryButton: { marginTop: 16, paddingVertical: 10 },
  secondaryButtonText: { color: '#1DB954', fontSize: 15, fontWeight: '600' },
  status: { color: '#fff', fontSize: 14, marginTop: 16, textAlign: 'center' },
  notice: { color: '#b3b3b3', fontSize: 13, marginTop: 16, textAlign: 'center' },
  error: { color: '#f15e6c', fontSize: 14, marginBottom: 16, textAlign: 'center' },
  clearCacheButton: {
    marginTop: 28,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  clearCacheText: { color: '#b3b3b3', fontSize: 13, fontWeight: '600' },
  logOutButton: { marginTop: 40 },
  logOutText: { color: '#666', fontSize: 13 },
});
