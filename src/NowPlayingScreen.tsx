import { ActionSheetIOS, ActivityIndicator, Image, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ChevronUpIcon,
  EllipsisIcon,
  HeartIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  RepeatIcon,
  ReshuffleIcon,
  VinylIcon,
} from './icons';
import { ProgressBar } from './ProgressBar';
import type { SpotifyPlayer } from './spotifyPlayer';
import { colors, trackColors } from './theme';

const SPOTIFY_APP_STORE_URL = 'https://apps.apple.com/app/spotify/id324684580';

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function Header({ onOpenMenu }: { onOpenMenu: () => void }) {
  return (
    <View style={styles.headerRow}>
      <View style={styles.headerIconButton}>
        <ChevronUpIcon color={colors.iconMuted} />
      </View>
      <Text style={styles.headerLabel}>Playing from Pure Shuffle</Text>
      <TouchableOpacity style={styles.headerIconButton} onPress={onOpenMenu} hitSlop={8}>
        <EllipsisIcon color={colors.iconMuted} />
      </TouchableOpacity>
    </View>
  );
}

export function NowPlayingScreen({
  player,
  playlistId,
  trackCount,
  notice,
  onReshuffle,
  onClearCache,
  onLogOut,
}: {
  player: SpotifyPlayer;
  playlistId: string;
  trackCount: number | null;
  notice: string | null;
  onReshuffle: () => void;
  onClearCache: () => void;
  onLogOut: () => void;
}) {
  const openMenu = () => {
    const options = ['Open in Spotify', 'Clear cached library', 'Log out', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: 3, destructiveButtonIndex: 2 },
      (index) => {
        if (index === 0) Linking.openURL(`spotify:playlist:${playlistId}`);
        if (index === 1) onClearCache();
        if (index === 2) onLogOut();
      }
    );
  };

  if (player.spotifyInstalled === false) {
    return (
      <SafeAreaView style={styles.screen}>
        <Header onOpenMenu={openMenu} />
        <View style={styles.centeredBody}>
          <Text style={styles.notice}>Install the Spotify app to play here.</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => Linking.openURL(SPOTIFY_APP_STORE_URL)}>
            <Text style={styles.secondaryButtonText}>Get Spotify</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (player.connection !== 'connected' || !player.snapshot) {
    return (
      <SafeAreaView style={styles.screen}>
        <Header onOpenMenu={openMenu} />
        <View style={styles.centeredBody}>
          {trackCount != null && <Text style={styles.notice}>Shuffled {trackCount} songs into "Pure Shuffle"</Text>}
          {notice != null && <Text style={styles.notice}>{notice}</Text>}
          <TouchableOpacity
            style={styles.bigPlayButton}
            onPress={() => player.playPlaylist(playlistId)}
            disabled={player.connection === 'connecting'}
          >
            {player.connection === 'connecting' ? (
              <ActivityIndicator color={colors.pageBackground} />
            ) : (
              <PlayIcon size={30} />
            )}
          </TouchableOpacity>
          {player.playerError != null && <Text style={styles.errorText}>{player.playerError}</Text>}
        </View>
      </SafeAreaView>
    );
  }

  const { track, isPaused, repeatMode } = player.snapshot;
  const { accent, gradientTop, gradientBottom } = trackColors(track?.uri ?? null);
  const progress = player.durationMs > 0 ? Math.min(player.positionMs / player.durationMs, 1) : 0;

  return (
    <SafeAreaView style={styles.screen}>
      <Header onOpenMenu={openMenu} />

      <View style={styles.artWrap}>
        {player.albumArtUri != null ? (
          <Image source={{ uri: player.albumArtUri }} style={styles.art} />
        ) : (
          <LinearGradient
            colors={[gradientTop, gradientBottom]}
            start={{ x: 0.3, y: 0 }}
            end={{ x: 0.7, y: 1 }}
            style={styles.art}
          >
            <VinylIcon size={26} color={colors.vinylIcon} />
          </LinearGradient>
        )}
      </View>

      <View style={styles.footer}>
        <View style={styles.titleRow}>
          <View style={styles.titleTextBlock}>
            <Text style={styles.trackName} numberOfLines={1}>
              {track?.name ?? 'Nothing playing'}
            </Text>
            <Text style={styles.artistName} numberOfLines={1}>
              {track?.artistName ?? ''}
            </Text>
          </View>
          <TouchableOpacity onPress={player.toggleLike} hitSlop={8}>
            <HeartIcon
              filled={player.isTrackSaved}
              color={player.isTrackSaved ? accent : colors.iconMuted}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.progressBlock}>
          <ProgressBar progress={progress} accentColor={accent} onSeek={(p) => player.seekTo(p * player.durationMs)} />
          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{formatTime(player.positionMs)}</Text>
            <Text style={styles.timeText}>-{formatTime(Math.max(0, player.durationMs - player.positionMs))}</Text>
          </View>
        </View>

        <View style={styles.transportRow}>
          <TouchableOpacity onPress={onReshuffle} hitSlop={8} style={styles.transportSideButton}>
            <ReshuffleIcon color={colors.secondaryText} />
          </TouchableOpacity>
          <TouchableOpacity onPress={player.skipPrevious} hitSlop={4} style={styles.transportSideButton}>
            <PrevIcon />
          </TouchableOpacity>
          <TouchableOpacity onPress={player.togglePlayPause} style={styles.playPauseButton}>
            {isPaused ? <PlayIcon size={26} /> : <PauseIcon size={26} />}
          </TouchableOpacity>
          <TouchableOpacity onPress={player.skipNext} hitSlop={4} style={styles.transportSideButton}>
            <NextIcon />
          </TouchableOpacity>
          <TouchableOpacity onPress={player.cycleRepeat} hitSlop={8} style={styles.transportSideButton}>
            <RepeatIcon
              mode={repeatMode}
              color={repeatMode === 'off' ? colors.secondaryText : accent}
            />
          </TouchableOpacity>
        </View>

        {player.playerError != null && <Text style={styles.errorText}>{player.playerError}</Text>}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.pageBackground,
    paddingTop: 12,
    paddingHorizontal: 26,
    paddingBottom: 28,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerIconButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerLabel: {
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.secondaryText,
    fontWeight: '600',
  },
  centeredBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notice: { color: colors.secondaryText, fontSize: 13, textAlign: 'center', marginBottom: 16 },
  bigPlayButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.nearWhite,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  secondaryButton: { marginTop: 4, paddingVertical: 10 },
  secondaryButtonText: { color: colors.nearWhite, fontSize: 15, fontWeight: '600' },
  artWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  art: {
    width: 260,
    height: 260,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 60,
    shadowOffset: { width: 0, height: 24 },
    elevation: 12,
  },
  footer: { marginTop: 22 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  titleTextBlock: { minWidth: 0, flex: 1 },
  trackName: { fontSize: 22, fontWeight: '700', color: colors.nearWhite, letterSpacing: -0.2 },
  artistName: { fontSize: 15, color: colors.secondaryText, marginTop: 3 },
  progressBlock: { marginTop: 20 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  timeText: { fontSize: 12, color: colors.timeLabel, fontVariant: ['tabular-nums'] },
  transportRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26 },
  transportSideButton: { padding: 8 },
  playPauseButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: colors.nearWhite,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  errorText: { color: colors.error, fontSize: 13, marginTop: 16, textAlign: 'center' },
});
