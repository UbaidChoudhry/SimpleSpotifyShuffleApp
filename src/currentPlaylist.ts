import { File, Paths } from 'expo-file-system';

const FILE_NAME = 'current-playlist.json';

/**
 * Remembers which playlist the last shuffle created.
 *
 * Without this, finding "the current playlist" means paging through the user's
 * entire playlist library by name — on every launch and every shuffle. Since
 * each shuffle now creates a fresh playlist, the ID is known at creation time
 * and there's no reason to go looking for it again.
 */
export async function loadCurrentPlaylistId(): Promise<string | null> {
  try {
    const file = new File(Paths.document, FILE_NAME);
    if (!file.exists) return null;
    const parsed = JSON.parse(await file.text());
    return typeof parsed?.playlistId === 'string' ? parsed.playlistId : null;
  } catch {
    // A missing or corrupt pointer just means falling back to a lookup.
    return null;
  }
}

export async function saveCurrentPlaylistId(playlistId: string): Promise<void> {
  try {
    const file = new File(Paths.document, FILE_NAME);
    file.create({ intermediates: true, overwrite: true });
    file.write(JSON.stringify({ playlistId }));
  } catch {
    // Failing to persist only costs a lookup next launch.
  }
}

export async function clearCurrentPlaylistId(): Promise<void> {
  try {
    const file = new File(Paths.document, FILE_NAME);
    if (file.exists) file.delete();
  } catch {
    // Nothing to do.
  }
}
