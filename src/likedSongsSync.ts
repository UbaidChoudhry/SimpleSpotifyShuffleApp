import type { LikedSongsCache } from './likedSongsCache';

export const LIKED_SONGS_PAGE_SIZE = 50;
// How far down the list to hunt for the cached head before giving up. Past ~200
// additions a full resync costs less than continuing to probe.
export const PROBE_PAGE_LIMIT = 4;

export interface SavedTracksPage {
  total: number;
  uris: string[];
  addedAt: string[];
}

export type PageFetcher = (offset: number) => Promise<SavedTracksPage>;

// The incremental path assumes Spotify returns saved tracks newest-first. That
// holds in practice but is not a documented guarantee, so it is verified before
// the cache is trusted; if the order ever changes we fall back to a full sync
// rather than silently corrupting the cache.
export function isNewestFirst(page: SavedTracksPage): boolean {
  for (let i = 1; i < page.addedAt.length; i++) {
    if (page.addedAt[i] > page.addedAt[i - 1]) return false;
  }
  return true;
}

export interface IncrementalResult {
  /** `null` means the caller must fall back to a full sync. */
  uris: string[] | null;
  /** Pages already fetched, so a fallback sync does not re-request them. */
  probedPages: SavedTracksPage[];
}

export async function tryIncrementalSync(
  cache: LikedSongsCache,
  fetchPage: PageFetcher
): Promise<IncrementalResult> {
  const probedPages: SavedTracksPage[] = [];
  const firstPage = await fetchPage(0);
  probedPages.push(firstPage);

  // The cached head track is the anchor. Identity is used rather than added_at
  // because that timestamp is only second-precision, so a bulk add can give many
  // tracks the same value; a URI is unique within Liked Songs.
  const anchor = cache.uris[0];
  if (!anchor || !isNewestFirst(firstPage)) return { uris: null, probedPages };

  // Any addition puts a new track at the head, so an unchanged head means nothing
  // was added — and with the total unchanged too, nothing was removed either.
  if (firstPage.total === cache.total && firstPage.uris[0] === anchor) {
    return { uris: cache.uris, probedPages };
  }

  // A shrinking total means at least one removal, which the head cannot reveal.
  if (firstPage.total < cache.total) return { uris: null, probedPages };

  const added: string[] = [];
  for (let pageIndex = 0; pageIndex < PROBE_PAGE_LIMIT; pageIndex++) {
    if (pageIndex >= probedPages.length) {
      probedPages.push(await fetchPage(pageIndex * LIKED_SONGS_PAGE_SIZE));
    }

    for (const uri of probedPages[pageIndex].uris) {
      if (uri === anchor) {
        // Everything above the anchor is new. If that prefix does not account for
        // the change in total exactly, something was also removed further down,
        // which only a full sync can locate.
        return added.length === firstPage.total - cache.total
          ? { uris: [...added, ...cache.uris], probedPages }
          : { uris: null, probedPages };
      }
      added.push(uri);
    }

    if ((pageIndex + 1) * LIKED_SONGS_PAGE_SIZE >= firstPage.total) break;
  }

  return { uris: null, probedPages };
}

export async function fullSync(
  seedPages: SavedTracksPage[],
  fetchPage: PageFetcher,
  onProgress?: (fetched: number, total: number) => void
): Promise<{ total: number; uris: string[] }> {
  const uris: string[] = [];
  for (const page of seedPages) uris.push(...page.uris);

  let offset = seedPages.length * LIKED_SONGS_PAGE_SIZE;
  let total = seedPages.length > 0 ? seedPages[seedPages.length - 1].total : Number.POSITIVE_INFINITY;
  if (Number.isFinite(total)) onProgress?.(Math.min(offset, total), total);

  while (offset < total) {
    const page = await fetchPage(offset);
    total = page.total;
    uris.push(...page.uris);
    offset += LIKED_SONGS_PAGE_SIZE;
    onProgress?.(Math.min(offset, total), total);
  }

  return { total, uris };
}
