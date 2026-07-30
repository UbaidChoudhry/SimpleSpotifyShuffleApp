import { forceRefreshAccessToken, getValidAccessToken } from './auth';
import { loadCurrentPlaylistId, saveCurrentPlaylistId } from './currentPlaylist';
import { PLAYLIST_DESCRIPTION, PLAYLIST_NAME } from './config';
import { loadLikedSongsCache, saveLikedSongsCache } from './likedSongsCache';
import { fullSync, LIKED_SONGS_PAGE_SIZE, SavedTracksPage, tryIncrementalSync } from './likedSongsSync';
import { randomSeed, seededShuffle } from './shuffle';

const API_BASE = 'https://api.spotify.com/v1';
const PLAYLIST_WRITE_CHUNK_SIZE = 100;
// Spotify can answer a 429 with a Retry-After of many hours when an app blows
// through its rolling quota. Sleeping that long is indistinguishable from a
// frozen app, so anything beyond this fails fast with an explanation instead.
const MAX_RETRY_AFTER_SECONDS = 60;

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
  return `${Math.round((seconds / 3600) * 10) / 10} hours`;
}

async function spotifyFetch(
  path: string,
  options: RequestInit = {},
  alreadyRetriedAfter401 = false
): Promise<Response> {
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
    console.log(`[spotify] rate limited on ${options.method ?? 'GET'} ${path}, retry after ${retryAfterSec}s`);

    if (retryAfterSec > MAX_RETRY_AFTER_SECONDS) {
      throw new Error(
        `Spotify is rate limiting this app for another ${formatDuration(retryAfterSec)}. ` +
          `This clears on its own — try again later.`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, (retryAfterSec + 1) * 1000));
    return spotifyFetch(path, options, alreadyRetriedAfter401);
  }

  // A token can be rejected server-side while still looking unexpired locally
  // (most often right after re-authorizing with a new scope set). Recover once
  // by forcing a refresh rather than failing the whole shuffle.
  if (response.status === 401 && !alreadyRetriedAfter401) {
    console.log(`[spotify] 401 on ${options.method ?? 'GET'} ${path} — forcing refresh and retrying`);
    await forceRefreshAccessToken();
    return spotifyFetch(path, options, true);
  }

  if (!response.ok) {
    const body = await response.text();
    // Spotify's body carries the actual reason (expired token vs. missing
    // scope vs. no active device), which the status code alone doesn't say.
    console.log(`[spotify] ${response.status} on ${options.method ?? 'GET'} ${path}: ${body.slice(0, 300)}`);
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

/**
 * Returns every playlist the user owns matching PLAYLIST_NAME.
 *
 * This pages the entire library, so it's only used to sweep up orphans left by
 * a run that died between creating the replacement and removing the previous
 * one — never on the normal path, which knows its playlist ID outright.
 */
async function findAllPlaylistIdsByName(): Promise<string[]> {
  const ids: string[] = [];
  let path: string | null = `/me/playlists?limit=50`;

  while (path) {
    const response = await spotifyFetch(path);
    const data = await response.json();
    for (const playlist of data.items ?? []) {
      if (playlist?.name === PLAYLIST_NAME && playlist?.id) ids.push(playlist.id);
    }
    path = data.next ? data.next.replace(API_BASE, '') : null;
  }

  return ids;
}

/** Spotify models "delete a playlist" as unfollowing it. */
async function unfollowPlaylist(playlistId: string): Promise<void> {
  await spotifyFetch(`/playlists/${playlistId}/followers`, { method: 'DELETE' });
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

async function replacePlaylistItems(
  playlistId: string,
  uris: string[],
  onProgress?: (written: number, total: number) => void
): Promise<void> {
  // The first write fully replaces the playlist's existing contents; every
  // chunk after that appends, so the final order matches `uris` exactly.
  // These have to stay sequential — the appends are order-dependent.
  const firstChunk = uris.slice(0, PLAYLIST_WRITE_CHUNK_SIZE);
  await spotifyFetch(`/playlists/${playlistId}/items`, {
    method: 'PUT',
    body: JSON.stringify({ uris: firstChunk }),
  });
  onProgress?.(Math.min(firstChunk.length, uris.length), uris.length);

  for (let i = PLAYLIST_WRITE_CHUNK_SIZE; i < uris.length; i += PLAYLIST_WRITE_CHUNK_SIZE) {
    const chunk = uris.slice(i, i + PLAYLIST_WRITE_CHUNK_SIZE);
    await spotifyFetch(`/playlists/${playlistId}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris: chunk }),
    });
    onProgress?.(Math.min(i + chunk.length, uris.length), uris.length);
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

  // Each shuffle goes into a brand-new playlist rather than rewriting the
  // existing one. The Spotify client caches playlist contents by URI and has
  // no API to invalidate that cache, so reusing the URI meant playback always
  // replayed the pre-shuffle order until the user manually refreshed the
  // playlist in the Spotify app. A URI the client has never seen forces it to
  // fetch the real contents.
  //
  // The previous playlist's ID is remembered locally, so the common path costs
  // nothing. Paging the whole library only happens when that pointer is
  // missing — a first run, or after a crash — which also sweeps up any
  // orphans a failed run left behind.
  const rememberedId = await loadCurrentPlaylistId();
  const previousPlaylistIds = rememberedId ? [rememberedId] : await findAllPlaylistIdsByName();

  const playlistId = await createPlaylist();
  await saveCurrentPlaylistId(playlistId);
  await replacePlaylistItems(playlistId, uris, (written, total) =>
    onProgress?.(`Writing shuffled order... ${written}/${total}`)
  );

  // Only after the replacement is fully written, so a failure mid-write never
  // leaves the user with no playlist at all.
  for (const previousId of previousPlaylistIds) {
    if (previousId === playlistId) continue;
    try {
      await unfollowPlaylist(previousId);
    } catch (err) {
      // Logged rather than swallowed: silent failures here accumulate
      // playlists, which slows every later run and is invisible otherwise.
      console.log(
        `[spotify] failed to delete old playlist ${previousId}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return { playlistId, trackCount: uris.length };
}

/**
 * Starts the playlist from its first track using Spotify's server-side
 * playback control rather than App Remote.
 *
 * This deliberately does NOT go through the local Spotify app: that app caches
 * playlist contents and keeps serving the pre-reshuffle order until it's
 * manually refreshed, so every App Remote play variant (context URI, bare
 * track URI, fetched content item with an explicit index) replayed the old
 * list. Going through the server makes Spotify resolve the playlist fresh.
 *
 * Note this is only used to restart an already-connected, already-playing
 * session — cold start still goes through SPTAppRemote.authorizeAndPlayURI.
 */
export async function startPlaylistFromTop(playlistId: string): Promise<void> {
  try {
    await spotifyFetch('/me/player/play', {
      method: 'PUT',
      body: JSON.stringify({
        context_uri: `spotify:playlist:${playlistId}`,
        offset: { position: 0 },
        position_ms: 0,
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('403')) {
      throw new Error(
        'Spotify rejected the playback command. Log out and back in to grant the new playback permission.'
      );
    }
    if (message.includes('404')) {
      throw new Error('No active Spotify device found. Start playback again, then reshuffle.');
    }
    throw err;
  }
}
