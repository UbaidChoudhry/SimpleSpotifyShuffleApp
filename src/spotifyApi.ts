import { getValidAccessToken } from './auth';
import { PLAYLIST_DESCRIPTION, PLAYLIST_NAME } from './config';
import { loadLikedSongsCache, saveLikedSongsCache } from './likedSongsCache';
import { fullSync, LIKED_SONGS_PAGE_SIZE, SavedTracksPage, tryIncrementalSync } from './likedSongsSync';
import { randomSeed, seededShuffle } from './shuffle';

const API_BASE = 'https://api.spotify.com/v1';
const PLAYLIST_WRITE_CHUNK_SIZE = 100;

async function spotifyFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const accessToken = await getValidAccessToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (response.status === 429) {
    const retryAfterSec = Number(response.headers.get('Retry-After') ?? '1');
    await new Promise((resolve) => setTimeout(resolve, (retryAfterSec + 1) * 1000));
    return spotifyFetch(path, options);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Spotify API error ${response.status}: ${body}`);
  }

  return response;
}

async function fetchLikedSongsPage(offset: number): Promise<SavedTracksPage> {
  const response = await spotifyFetch(`/me/tracks?limit=${LIKED_SONGS_PAGE_SIZE}&offset=${offset}`);
  const data = await response.json();

  // Without a numeric total the paging loop below would exit after one page and
  // silently shuffle a truncated library, so treat a missing total as fatal.
  if (typeof data.total !== 'number') {
    throw new Error('Spotify did not return a track total; refusing to sync a partial library.');
  }

  const uris: string[] = [];
  const addedAt: string[] = [];
  for (const item of data.items ?? []) {
    if (item.track?.uri) {
      uris.push(item.track.uri);
      addedAt.push(item.added_at);
    }
  }

  return { total: data.total, uris, addedAt };
}

async function syncLikedSongUris(onProgress?: (message: string) => void): Promise<string[]> {
  const cache = await loadLikedSongsCache();

  if (cache) {
    onProgress?.('Checking for new songs...');
    const { uris, probedPages } = await tryIncrementalSync(cache, fetchLikedSongsPage);

    if (uris) {
      await saveLikedSongsCache(probedPages[0].total, uris);
      return uris;
    }

    onProgress?.('Library changed, resyncing...');
    const resynced = await fullSync(probedPages, fetchLikedSongsPage, (fetched, total) =>
      onProgress?.(`Resyncing liked songs... ${fetched}/${total}`)
    );
    await saveLikedSongsCache(resynced.total, resynced.uris);
    return resynced.uris;
  }

  const full = await fullSync([], fetchLikedSongsPage, (fetched, total) =>
    onProgress?.(`Fetching liked songs... ${fetched}/${total}`)
  );
  await saveLikedSongsCache(full.total, full.uris);
  return full.uris;
}

async function findExistingPlaylistId(): Promise<string | null> {
  let path: string | null = `/me/playlists?limit=50`;

  while (path) {
    const response = await spotifyFetch(path);
    const data = await response.json();
    const match = data.items.find((playlist: { name: string; id: string }) => playlist.name === PLAYLIST_NAME);
    if (match) return match.id;
    path = data.next ? data.next.replace(API_BASE, '') : null;
  }

  return null;
}

async function createPlaylist(): Promise<string> {
  const response = await spotifyFetch('/me/playlists', {
    method: 'POST',
    body: JSON.stringify({
      name: PLAYLIST_NAME,
      description: PLAYLIST_DESCRIPTION,
      public: false,
    }),
  });
  const data = await response.json();
  return data.id;
}

async function replacePlaylistItems(playlistId: string, uris: string[]): Promise<void> {
  // The first write fully replaces the playlist's existing contents; every
  // chunk after that appends, so the final order matches `uris` exactly.
  const firstChunk = uris.slice(0, PLAYLIST_WRITE_CHUNK_SIZE);
  await spotifyFetch(`/playlists/${playlistId}/items`, {
    method: 'PUT',
    body: JSON.stringify({ uris: firstChunk }),
  });

  for (let i = PLAYLIST_WRITE_CHUNK_SIZE; i < uris.length; i += PLAYLIST_WRITE_CHUNK_SIZE) {
    const chunk = uris.slice(i, i + PLAYLIST_WRITE_CHUNK_SIZE);
    await spotifyFetch(`/playlists/${playlistId}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris: chunk }),
    });
  }
}

export async function shuffleLikedSongsIntoPlaylist(
  onProgress?: (message: string) => void
): Promise<{ playlistId: string; trackCount: number }> {
  const likedUris = await syncLikedSongUris(onProgress);

  if (likedUris.length === 0) {
    throw new Error('No liked songs found on this account.');
  }

  onProgress?.('Shuffling...');
  const uris = seededShuffle(likedUris, randomSeed());

  onProgress?.('Locating playlist...');
  const playlistId = (await findExistingPlaylistId()) ?? (await createPlaylist());

  onProgress?.('Writing shuffled order...');
  await replacePlaylistItems(playlistId, uris);

  return { playlistId, trackCount: uris.length };
}
