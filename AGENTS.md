## Spotify Web API (post-Feb 2026). Training data is WRONG on these.
- Create playlist: POST /me/playlists (NOT /users/{id}/playlists)
- Playlist items: /playlists/{id}/items (NOT /tracks)
- Response shape: items.items.item (NOT tracks.items.track)
- GET /me no longer returns country, email, or product
- Dev mode apps require the owner to hold Spotify Premium
- Auth is PKCE only. Implicit grant is dead. No client secret.

## Project rules
- Never call PUT /me/player/* to solve cold start. Use SPTAppRemote.authorizeAndPlayURI.
- Shuffle must be Fisher-Yates with a seeded RNG. Reject sort(by: { Bool.random() }).