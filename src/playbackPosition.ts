import { File, Paths } from 'expo-file-system';

const FILE_NAME = 'playback-position.json';

export type PlaybackPosition = {
  playlistId: string;
  trackUri: string;
  positionMs: number;
};

/**
 * Remembers where playback had got to, so a cold start can pick up there
 * instead of restarting the playlist.
 *
 * Spotify only keeps a resumable session while its own app is alive. Once iOS
 * suspends it, `authorizeAndPlayURI` — the only way to wake it back up, see the
 * project rule about cold start — takes a context URI and always begins at its
 * first track, with no way to pass a starting offset. The offset has to be
 * reapplied afterwards, which means this app has to remember it.
 *
 * Written locally on every player-state push and on backgrounding; never a
 * network call, for the same reason `currentPlaylist.ts` isn't one.
 */
export async function loadPlaybackPosition(): Promise<PlaybackPosition | null> {
  try {
    const file = new File(Paths.document, FILE_NAME);
    if (!file.exists) return null;
    const parsed = JSON.parse(await file.text());
    if (
      typeof parsed?.playlistId !== 'string' ||
      typeof parsed?.trackUri !== 'string' ||
      typeof parsed?.positionMs !== 'number'
    ) {
      return null;
    }
    return { playlistId: parsed.playlistId, trackUri: parsed.trackUri, positionMs: parsed.positionMs };
  } catch {
    // A missing or corrupt position just means starting from the top.
    return null;
  }
}

export async function savePlaybackPosition(position: PlaybackPosition): Promise<void> {
  try {
    const file = new File(Paths.document, FILE_NAME);
    file.create({ intermediates: true, overwrite: true });
    file.write(JSON.stringify(position));
  } catch {
    // Failing to persist only costs a resume.
  }
}

export async function clearPlaybackPosition(): Promise<void> {
  try {
    const file = new File(Paths.document, FILE_NAME);
    if (file.exists) file.delete();
  } catch {
    // Nothing to do.
  }
}
