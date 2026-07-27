# Pure Shuffle

A truly random shuffle of your Spotify Liked Songs.

## Why

Spotify's built-in shuffle is not a uniform random permutation. It reorders playback with weighting and clustering, so certain tracks resurface constantly while others effectively never play.

Pure Shuffle sidesteps that entirely. It reads your Liked Songs, shuffles them with a **Fisher-Yates** permutation driven by a seeded PRNG, and writes the result into a playlist called **Pure Shuffle** in that exact order.

You then play that playlist **with Spotify's own shuffle turned OFF**. The randomness is already baked into the track order, so Spotify just plays it top to bottom. Tap the button again whenever you want a fresh permutation.

The shuffle itself is in [`src/shuffle.ts`](src/shuffle.ts) — a mulberry32 PRNG plus a standard Fisher-Yates loop. Notably it does *not* use `array.sort(() => Math.random() - 0.5)`, which is biased and leaves runs of adjacent tracks intact.

## Quickstart

### 1. Prerequisites

- Node.js and npm
- Xcode (for iOS) — the app uses native modules, so **Expo Go will not work**
- A Spotify account. The Spotify app you register runs in development mode by default, which requires the account that owns it to have **Premium**

### 2. Register a Spotify app

Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app, then:

- Under **Edit Settings → Redirect URIs**, add exactly:
  ```
  pureshuffle://callback
  ```
  This must match `REDIRECT_URI` in [`src/config.ts`](src/config.ts) and the `scheme` in [`app.json`](app.json). A mismatch fails at the authorize step with `INVALID_CLIENT`.
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

> **Environment variables are inlined at bundle time, not hot-reloaded.** After editing `.env` you must fully restart the dev server — pressing `r` in Metro or `⌘R` in the simulator is not enough. You'll know it worked when startup logs `env: load .env`.

### 5. Run

```bash
npm run ios
```

This builds the native app and installs it on a simulator. First build takes several minutes; subsequent runs are much faster.

Once it's running, tap **Connect Spotify**, complete the login, then **Shuffle Now**.

## Running on a physical device

Needed for testing the "Open in Spotify" deep link, which can't work on a simulator (no Spotify app installed there).

```bash
npm run ios -- --device --configuration Release
```

Requirements:

- An Apple ID added to Xcode (**Settings → Accounts**). A free account is sufficient.
- A signing certificate (**Settings → Accounts → Manage Certificates → + → Apple Development**). Adding the Apple ID alone does not create one.
- **Developer Mode** enabled on the phone (Settings → Privacy & Security → Developer Mode), then reboot.
- After install, trust the certificate: Settings → General → VPN & Device Management → your developer profile → **Trust**.

`Release` is recommended over the default `Debug` because it bundles the JavaScript into the binary, so the app runs standalone instead of needing Metro on the same network.

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

### Cache storage

A single JSON file, `liked-songs-cache.json`, in the app's Documents directory via `expo-file-system` (~75KB for 2,000 tracks). Documents rather than Caches, because iOS may purge the cache directory under storage pressure and silently force a full resync.

The cache is versioned and validated on read. Anything corrupt or unrecognized is discarded in favour of a full sync, so a bad cache costs one slow run and never yields wrong data. It is cleared automatically on logout so a second account can't inherit the first one's library, and manually via the **Clear cached library** button — which also appears in the error state as a recovery path.

## Project layout

```
App.tsx                    UI and state machine
src/config.ts              Client ID, redirect URI, scopes, playlist name
src/auth.ts                PKCE login, token refresh, Keychain storage
src/spotifyApi.ts          Spotify HTTP calls and sync orchestration
src/likedSongsSync.ts      Delta-sync algorithm (pure, no I/O)
src/likedSongsCache.ts     Cache persistence
src/shuffle.ts             Seeded Fisher-Yates
```

## Notes and limitations

- **Play with Spotify shuffle off.** The point is that the order is already random. Leaving shuffle on re-randomizes it with the same biased algorithm this project exists to avoid.
- **The playlist is fully rewritten each run.** The first write replaces the playlist's contents and subsequent chunks append, ~20 requests for 2,000 tracks. This isn't transactional — a network failure mid-write can leave the playlist partially populated. Running the shuffle again fixes it.
- **Transient `503`s.** Spotify's API returns intermittent 5xx errors. The client retries on `429` but not on 5xx, so an unlucky run can fail outright. Retrying usually succeeds.
- **iOS only, so far.** An Android script exists (`npm run android`) but has not been tested.

## License

GPL-3.0. See [LICENSE](LICENSE).
