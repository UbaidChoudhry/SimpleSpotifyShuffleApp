import * as SecureStore from 'expo-secure-store';

const APP_REMOTE_TOKEN_KEY = 'spotify_app_remote_token';

/**
 * The access token the App Remote SDK hands back after its own authorization.
 *
 * It lives here rather than in `spotifyPlayer.ts` so `auth.ts` can clear it on
 * logout without importing the player, which now imports `auth.ts` back for a
 * refreshable token to connect with.
 *
 * Only a fallback: it is not refreshable and goes stale within the hour, so the
 * player prefers the Web API's token — see `connectTokens` in
 * `spotifyPlayer.ts`.
 */
export function saveAppRemoteToken(token: string): void {
  void SecureStore.setItemAsync(APP_REMOTE_TOKEN_KEY, token);
}

export function loadAppRemoteToken(): Promise<string | null> {
  return SecureStore.getItemAsync(APP_REMOTE_TOKEN_KEY);
}

export async function clearAppRemoteToken(): Promise<void> {
  await SecureStore.deleteItemAsync(APP_REMOTE_TOKEN_KEY);
}
