# Pure Shuffle

A truly random shuffle of your Spotify Liked Songs.

## Why

Spotify's built-in shuffle is not a uniform random permutation. It reorders playback with weighting and clustering, so certain tracks resurface constantly while others effectively never play.

Pure Shuffle sidesteps that entirely. It reads your Liked Songs, shuffles them with a **Fisher-Yates** permutation driven by a seeded PRNG, and writes the result into a playlist called **Pure Shuffle** in that exact order.

You then play it — either in-app or in Spotify itself — **with Spotify's own shuffle turned OFF**. The randomness is already baked into the track order, so Spotify just plays it top to bottom. Tap Reshuffle whenever you want a fresh permutation; whenever the in-app player is connected it restarts from the new track 1 — see [Reshuffle and playback](#reshuffle-and-playback).

The shuffle itself is in [`src/shuffle.ts`](src/shuffle.ts) — a mulberry32 PRNG plus a standard Fisher-Yates loop. Notably it does *not* use `array.sort(() => Math.random() - 0.5)`, which is biased and leaves runs of adjacent tracks intact.

## Quickstart

### 1. Prerequisites

- Node.js and npm
- Xcode (for iOS) — the app uses native modules, so **Expo Go will not work**
- A Spotify account. The Spotify app you register runs in development mode by default, which requires the account that owns it to have **Premium**

### 2. Register a Spotify app

Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app, then:

- Under **Edit Settings → Redirect URIs**, add **both**:
  ```
  pureshuffle://callback
  pureshuffle://spotify-app-remote-callback
  ```
  The first is the Web API login; the second is the in-app player's own authorization handshake — they're deliberately separate (see [In-app player](#in-app-player) below). Both must match `REDIRECT_URI` / `APP_REMOTE_REDIRECT_URI` in [`src/config.ts`](src/config.ts) and the `scheme` in [`app.json`](app.json) exactly. A mismatch fails at the authorize step with `INVALID_CLIENT`.
- Under **User Management**, add the Spotify account you'll log in with. Development-mode apps only authorize explicitly listed accounts.

Copy the **Client ID**. There is no client secret — see [Authentication](#authentication) below.

### 3. Install

```bash
npm install
```

### 4. Configure

```bash
cp .env.example .env
```

Then edit `.env` and paste your Client ID:

```
EXPO_PUBLIC_SPOTIFY_CLIENT_ID=your_client_id_here
```

`.env` is gitignored. `.env.example` is committed as the template.

An optional second setting caps outbound Spotify Web API requests per second (default `20` if unset):

```
EXPO_PUBLIC_SPOTIFY_MAX_TPS=20
```

Lower it if you start seeing `429` responses. Note this caps request *rate*, not total request count — Spotify's quota is a rolling window over the total, so the bigger lever is [avoiding unnecessary calls](#why-a-new-playlist-each-time) rather than pacing them.

> **Environment variables are inlined at bundle time, not hot-reloaded.** After editing `.env` you must fully restart the dev server — pressing `r` in Metro or `⌘R` in the simulator is not enough. You'll know it worked when startup logs `env: load .env`.

### 5. Run

```bash
npm run ios
```

This builds the native app and installs it on a simulator. First build takes several minutes; subsequent runs are much faster.

Once it's running, tap **Connect Spotify**, complete the login, then **Shuffle Now**. The in-app player itself won't connect on a simulator — see [In-app player](#in-app-player) — but everything else (shuffling, caching, playlist writes) works there.

## Running on a physical device

A physical device is required to test the in-app player (App Remote can't connect on a simulator at all) and the "Open in Spotify" deep link (no Spotify app installed on a simulator).

```bash
# Everyday iteration — Metro attached, JS fast-refreshes, phone and Mac on the same network
npm run ios -- --device --configuration Debug

# Final verification / standalone install
npm run ios -- --device --configuration Release
```

Requirements:

- An Apple ID added to Xcode (**Settings → Accounts**). A free account is sufficient.
- A signing certificate (**Settings → Accounts → Manage Certificates → + → Apple Development**). Adding the Apple ID alone does not create one.
- **Developer Mode** enabled on the phone (Settings → Privacy & Security → Developer Mode), then reboot.
- After install, trust the certificate: Settings → General → VPN & Device Management → your developer profile → **Trust**.

Use `Debug` while iterating on the player — JS changes fast-refresh over Metro without a native rebuild. Switch to `Release` for final verification or standalone use: it bundles the JavaScript into the binary, so the app runs without Metro at all.

With a free Apple account, builds stop launching after **7 days**. Rerun the command to reinstall.

## How it works

### Authentication

**PKCE only.** There is no client secret, by design — a client secret cannot be kept secret in a mobile binary, so Spotify's PKCE flow uses a code verifier instead. Tokens are stored in the device Keychain via `expo-secure-store` and never touch the repo. See [`src/auth.ts`](src/auth.ts).

### Incremental library sync

Naively, every shuffle would re-download the entire library — roughly 40 requests for a 2,000-song library, every single time. Instead the track list is cached locally and only the delta is fetched.

Spotify offers no "what changed" endpoint (`/me/tracks` accepts only `market`, `limit`, and `offset`), so the sync is built on two observations: saved tracks come back newest-first, and any newly added track therefore appears at the head of the list.

On each shuffle, only page 0 is fetched, then:

| Situation | Result | Requests |
|---|---|---|
| Nothing changed | Cache reused as-is | **1** |
| Songs added | Walk the head, prepend the new ones | **1–3** |
| Songs removed | Full resync | ~40 |
| Mixed add + remove | Full resync | ~40 |

Removals are invisible from the head of the list, so they're detected by reconciliation: the number of new tracks found must exactly equal the change in Spotify's reported `total`. If it doesn't, something was removed and a full resync runs. This is why removals are correct but not cheap.

The fast path is safe because adding a track always stamps a new `added_at`, so an unchanged head means nothing was added — and combined with an unchanged `total`, nothing was removed either.

Two safeguards:

- **Ordering guard.** Newest-first ordering is consistent in practice but is not a documented API guarantee, so it's verified before the cache is trusted. If the order ever changes, the code falls back to a full sync rather than corrupting the cache.
- **Identity anchoring.** The cached head is located by track URI, not by timestamp. `added_at` is only second-precision, so bulk-adding an album gives many tracks the same value and a timestamp comparison would silently skip songs.

The algorithm lives in [`src/likedSongsSync.ts`](src/likedSongsSync.ts) and takes its page fetcher as a parameter, so it has no network or filesystem dependencies and can be tested in isolation.

### In-app player

Playback is controlled with Spotify's **App Remote SDK** (`SPTAppRemote`), not the Web API's `/me/player` endpoints — the latter can't reliably start playback from a cold start on a device that isn't already an active Spotify Connect target. App Remote instead app-switches to the Spotify app itself to authorize and play.

This means **two separate authorization handshakes** exist side by side:

| | Web API login | In-app player |
|---|---|---|
| Flow | PKCE via `ASWebAuthenticationSession` | App Remote via app-switch to Spotify |
| Redirect URI | `pureshuffle://callback` | `pureshuffle://spotify-app-remote-callback` |
| Touches `AppDelegate`? | No | Yes — Spotify calls back into the app's URL scheme |
| Token stored at | `spotify_access_token` (Keychain) | `spotify_app_remote_token` (Keychain) |

They're deliberately kept on distinct redirect URIs. `SPTAppRemote` only validates the URL *scheme*, not the full path, so sharing one URI would let the App Remote handler attempt to parse an unrelated PKCE callback.

The native SDK is wrapped in a local Expo Module at [`modules/spotify-app-remote/`](modules/spotify-app-remote/) — not the community `react-native-spotify-remote` package, which has no confirmed support for React Native's New Architecture (enabled in this project). The wrapper wires an `ExpoAppDelegateSubscriber` to catch the App Remote callback, and exposes play/pause/skip/seek plus a player-state event stream to [`src/spotifyPlayer.ts`](src/spotifyPlayer.ts), which layers on progress-bar interpolation (the SDK only pushes state on discrete changes, not continuously) and reconnect-on-foreground.

The SDK itself is vendored via CocoaPods' `apple.extraPods` mechanism, fetched directly from [spotify/ios-sdk](https://github.com/spotify/ios-sdk) at a pinned tag — nothing is committed to this repo, and `ios/` is gitignored regardless.

**Cannot be tested in the iOS Simulator.** App Remote requires the real Spotify app to be running; on a simulator, `isSpotifyInstalled()` correctly reports `false` and the UI shows an install prompt, but the connection itself is only testable on a physical device.

The app also calls `setShuffle(false)` on every connect — enforcing the "play with shuffle off" rule above programmatically rather than only documenting it.

Alongside the transport buttons, the album art is **swipeable**: drag it left to skip forward, right to go back. The art trails the finger at damped speed and springs back on release rather than animating out with the swipe — the replacement artwork is fetched asynchronously after the track actually changes, so a hand-off animation would be sliding in the *old* image. The gesture only claims a touch once it is clearly horizontal, leaving taps and vertical drags alone.

### Resuming where you left off

Opening the app and hitting Play picks up at the track and offset playback had reached, instead of restarting the playlist.

This has to be done in two steps. `authorizeAndPlayURI` is the only thing that can wake a suspended Spotify — the Web API has no active device to command at that point — and it takes a context URI with **no offset parameter**, so it always starts at track 1. The remembered offset is therefore reapplied once App Remote reports `connected`, via `PUT /me/player/play` against the session that just came up ([`resumePlaylistAt`](src/spotifyApi.ts), driven by `startPlayback` in [`App.tsx`](App.tsx)).

The position lives in `playback-position.json` next to the library cache, written on every player-state push *and* on backgrounding — the pushes are discrete events, so without the background write the saved offset would be stale by however long playback ran after the last one. Launch still reads nothing but local files.

Two rules keep it from doing more harm than good:

- **The track is addressed by URI, never by index.** An index would mean persisting the playlist's order too, and a stale index resumes into the wrong song rather than failing visibly.
- **A Spotify session this app didn't just wake is authoritative.** If Spotify was still running, it never lost the user's place, while the saved position is only as fresh as the last state push before this app stopped running — so overriding it would *rewind* playback. `player.lastConnectionOrigin()` distinguishes "we woke it" from "it was already there". The saved position still wins when Spotify has since moved on to some other album or playlist.

Only playlist contexts are recorded, so a detour through an album or a radio session in the Spotify app can't overwrite your place in the shuffle. And because every shuffle lands in a new playlist, a position saved against a previous one is discarded rather than applied.

### Why a new playlist each time

Each shuffle writes into a **freshly created** playlist and deletes the previous one, rather than rewriting a single stable playlist. This looks wasteful and isn't — it's the only thing that makes reshuffling actually work.

The Spotify client caches playlist contents keyed by URI, and there is no API to invalidate that cache. Rewriting the same playlist updates it on Spotify's servers, but the phone keeps serving its stale copy until you manually open the playlist in the Spotify app and refresh it. So a reshuffle would rewrite the playlist correctly and then keep playing the *old* order.

That cache sits below both control planes, so no play command can route around it. All of these were tried and all failed identically:

| Approach | Result |
|---|---|
| App Remote `play(playlistUri)` | plays stale cached order |
| App Remote `play(trackUri)` | correct track, but no queue — playback stops after one song |
| App Remote `fetchContentItem` + `play(item, skipToTrackIndex: 0)` | plays stale cached order |
| Web API `PUT /me/player/play` with `context_uri` | command accepted, client still plays stale cached order |

A URI the client has never seen has nothing cached, so it must fetch the real contents. Hence: new playlist, every time.

Restart-after-reshuffle uses the Web API's `PUT /me/player/play` ([`startPlaylistFromTop`](src/spotifyApi.ts)) rather than App Remote. Note this does not contradict the "never use `/me/player/*` for cold start" rule in [CLAUDE.md](CLAUDE.md) — cold start still goes through `SPTAppRemote.authorizeAndPlayURI`; this is only the warm-session restart, and it needs the `user-modify-playback-state` scope.

### Reshuffle and playback

Because each shuffle lands in a brand-new playlist, Spotify is left holding a queue built from the **old** order until something explicitly repoints it. So whenever the in-app player is connected, a reshuffle ends by pointing playback at the new playlist and starting it from track 1.

The condition is *connected*, not *currently playing*. Gating it on "was playing" is the obvious-looking shortcut and it is wrong: reshuffling while paused would rewrite everything, delete the old playlist, and then leave the next tap on Play resuming the pre-shuffle order — from a playlist that no longer exists.

**A consequence worth knowing: reshuffling while paused starts playback.** Spotify offers no way to load a context without playing it. The tempting alternative — play, then immediately pause — races two independent commands, and when the pause loses the race it is discarded against a device that hadn't started yet, leaving the phone playing with no pause on the way. Starting playback is the predictable behaviour; the race is not.

One fallback exists on this path. Server-side playback needs a device Spotify still counts as *active*, and a session left paused for a few minutes stops being one — exactly the state a paused reshuffle runs in. That case surfaces as `NoActiveDeviceError` and falls back to App Remote, which can wake the local Spotify app. Every other playback failure propagates.

### Cache storage

A single JSON file, `liked-songs-cache.json`, in the app's Documents directory via `expo-file-system` (~75KB for 2,000 tracks). Documents rather than Caches, because iOS may purge the cache directory under storage pressure and silently force a full resync.

The cache is versioned and validated on read. Anything corrupt or unrecognized is discarded in favour of a full sync, so a bad cache costs one slow run and never yields wrong data. It is cleared automatically on logout so a second account can't inherit the first one's library, and manually via the **Clear cached library** button — which also appears in the error state as a recovery path.

## Project layout

```
App.tsx                              UI and state machine
src/config.ts                        Client ID, redirect URIs, scopes, playlist name
src/auth.ts                          PKCE login, token refresh, Keychain storage
src/spotifyApi.ts                    Spotify HTTP calls and sync orchestration
src/likedSongsSync.ts                Delta-sync algorithm (pure, no I/O)
src/likedSongsCache.ts               Cache persistence
src/shuffle.ts                       Seeded Fisher-Yates
src/currentPlaylist.ts               Remembers the current playlist ID (local file)
src/playbackPosition.ts              Remembers the last track and offset (local file)
src/spotifyPlayer.ts                 In-app player hook (progress interpolation, lifecycle)
src/NowPlayingScreen.tsx             In-app player UI
src/AlbumArt.tsx                     Album art with swipe-to-skip
src/ProgressBar.tsx                  Seekable progress bar
src/icons.tsx                        SVG icons
src/theme.ts                         Colours, per-track accent derivation
modules/spotify-app-remote/          Local Expo Module wrapping SPTAppRemote (native SDK)
```

## Notes and limitations

- **Play with Spotify shuffle off.** The point is that the order is already random. Leaving shuffle on re-randomizes it with the same biased algorithm this project exists to avoid. The in-app player enforces this on connect; if you play from the Spotify app directly instead, you need to turn shuffle off yourself.
- **Each shuffle creates a new playlist and deletes the previous one**, so the playlist link changes every time. This is deliberate and load-bearing — see [Why a new playlist each time](#why-a-new-playlist-each-time). Anything you pin or save pointing at a specific "Pure Shuffle" playlist will break on the next shuffle; the app's own "Open in Spotify" always targets the current one.
- **The playlist can't be downloaded for offline listening.** Spotify exposes no API for it — offline state is read-only in the App Remote SDK and absent from the Web API entirely — and a new playlist each shuffle would lose any manual download anyway.
- **Writes aren't transactional.** The first write sets the playlist's contents and subsequent chunks append, ~20 requests for 2,000 tracks. A network failure mid-write can leave a partially populated playlist; running the shuffle again fixes it. The previous playlist is only deleted after the replacement is fully written, so a failure never leaves you with nothing.
- **A reshuffle takes several seconds, and the music stops for all of them.** The whole chain is sequential: one request to check for new liked songs, one to create the playlist, ~20 to write 2,000 tracks (Spotify caps `/playlists/{id}/items` at 100 URIs per call), one to delete the old playlist, one to start playback. That's roughly 24 round trips — several seconds on Wi-Fi and noticeably worse on cellular — and playback is deliberately paused for the duration so the old order doesn't keep playing while the new one is being built. The outbound rate limiter is *not* a contributor here: each request already takes longer than the limiter's minimum spacing, so it never actually delays a sequential chain.
- **Reshuffling while paused starts playback.** See [Reshuffle and playback](#reshuffle-and-playback) — Spotify cannot load a playlist context without playing it.
- **Transient `503`s.** Spotify's API returns intermittent 5xx errors. The client retries on `429` but not on 5xx, so an unlucky run can fail outright. Retrying usually succeeds.
- **Rate limiting can lock the app out for hours.** Spotify answers a `429` with a `Retry-After`, and when an app exceeds its rolling quota that value can be *hours* — 14+ has been observed in practice on a dev-mode app. Three defences: a circuit breaker halts all requests for 30s after the first `429` (continuing to probe is what escalates a throttle into a lockout), waits longer than 60s fail fast rather than sleeping (which is indistinguishable from a frozen app), and launch makes no network calls at all so a throttled account can't strand the UI on a loading spinner. Once locked out, nothing clears it but time.
- **iOS only, so far.** An Android script exists (`npm run android`) but has not been tested.
- **In-app playback requires Spotify Premium and the Spotify app installed**, in addition to being logged in. Without the app, the UI falls back to an install prompt; you can still shuffle and use "Open in Spotify" either way.

## License

GPL-3.0. See [LICENSE](LICENSE).
