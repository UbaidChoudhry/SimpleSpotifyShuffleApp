import { File, Paths } from 'expo-file-system';

const CACHE_FILE_NAME = 'liked-songs-cache.json';
// Bump this whenever the shape below changes so old caches are discarded rather
// than misread.
const CACHE_VERSION = 1;

export interface LikedSongsCache {
  version: number;
  /** The `total` Spotify reported at the time of the last sync. */
  total: number;
  /** Track URIs in Spotify's saved order, newest first. */
  uris: string[];
}

function cacheFile(): File {
  return new File(Paths.document, CACHE_FILE_NAME);
}

export async function loadLikedSongsCache(): Promise<LikedSongsCache | null> {
  try {
    const file = cacheFile();
    if (!file.exists) return null;

    const parsed = JSON.parse(await file.text());
    if (parsed?.version !== CACHE_VERSION) return null;
    if (typeof parsed.total !== 'number' || !Array.isArray(parsed.uris)) return null;

    return parsed as LikedSongsCache;
  } catch {
    // A missing, corrupt, or unreadable cache is never fatal — the caller falls
    // back to a full sync.
    return null;
  }
}

export async function saveLikedSongsCache(total: number, uris: string[]): Promise<void> {
  try {
    const file = cacheFile();
    file.create({ intermediates: true, overwrite: true });
    file.write(JSON.stringify({ version: CACHE_VERSION, total, uris }));
  } catch {
    // Failing to persist only costs a full sync on the next run.
  }
}

export async function clearLikedSongsCache(): Promise<void> {
  try {
    const file = cacheFile();
    if (file.exists) file.delete();
  } catch {
    // Nothing to do — a stale cache is dropped on the next version mismatch.
  }
}
