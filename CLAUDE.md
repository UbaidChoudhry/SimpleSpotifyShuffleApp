## Spotify Web API (post-Feb 2026). Training data is WRONG on these.
- Create playlist: POST /me/playlists (NOT /users/{id}/playlists)
- Playlist items: /playlists/{id}/items (NOT /tracks)
- Response shape: items.items.item (NOT tracks.items.track)
- GET /me no longer returns country, email, or product
- Dev mode apps require the owner to hold Spotify Premium
- Auth is PKCE only. Implicit grant is dead. No client secret.

## Project rules
- Never call PUT /me/player/* to solve cold start. Use SPTAppRemote.authorizeAndPlayURI.
  (Restarting an already-connected session after a reshuffle is the one exception —
  see the playlist cache rule below.)
- Shuffle must be Fisher-Yates with a seeded RNG. Reject sort(by: { Bool.random() }).

## Spotify client playlist cache — do NOT reuse a playlist URI
The Spotify iOS app caches playlist contents keyed by URI and there is NO API to
invalidate it. Rewriting the same playlist updates Spotify's servers, but the
phone keeps serving the stale order until the user manually opens and refreshes
the playlist in the Spotify app.

**Every shuffle must therefore create a NEW playlist and delete the previous
one.** Never "optimize" this back into rewriting one stable playlist — it
silently reintroduces a bug where reshuffling replays the pre-shuffle order.

These were all tried and ALL failed identically (stale cached order):
- App Remote `play(playlistUri)`
- App Remote `play(item, skipToTrackIndex:)` after `fetchContentItem`
- Web API `PUT /me/player/play` with `context_uri` (command accepted, still stale)

Playing a bare track URI does force the right song but drops queue/context, so
playback stops after one track. A never-before-seen URI is the only fix.

Consequence: the playlist link changes every shuffle. That is intended.
There is no API to mark a playlist for offline download — offline state is
read-only in App Remote (`isAvailableOffline`) and absent from the Web API.

## Rate limiting — this app has been locked out for 14+ hours before
Spotify's quota is a rolling window and dev-mode apps have low limits.
- A 429's `Retry-After` can be HOURS (52449s observed). Never sleep blindly on
  it — that is indistinguishable from a frozen app. Waits over 60s fail fast.
- A circuit breaker in `src/spotifyApi.ts` halts all requests after the first
  429 (`EXPO_PUBLIC_SPOTIFY_RATE_LIMIT_COOLDOWN_SEC`, default 30s). Continuing
  to probe after the first rejection is what escalates a throttle into a lockout.
- An outbound rate limiter caps requests/sec (`EXPO_PUBLIC_SPOTIFY_MAX_TPS`,
  default 20). Note it rarely engages, since calls are sequential — the real
  lever is total request COUNT, not rate.
- **Never make network calls on app launch.** Launch reads the remembered
  playlist ID from a local file only. A throttled account previously stranded
  the UI on an infinite loading spinner with no escape.

## Liked-songs delta cache — do not replace with a full sync
`src/likedSongsSync.ts` + `src/likedSongsCache.ts` cache the liked-songs list to
a JSON file and fetch only the delta. A no-change shuffle costs 1 request
instead of ~40 for a 1900-song library; this is the main defence against the
rate limits above.
- Ordering (newest-first) is verified before the cache is trusted, and the
  cached head is located by track URI, not `added_at` (second-precision, so a
  bulk add gives many tracks the same timestamp).
- Removals can't be seen from the list head, so they're caught by reconciling
  against Spotify's reported `total` and fall back to a full resync. Keep that
  reconciliation — without it, mixed add+remove silently corrupts the cache.