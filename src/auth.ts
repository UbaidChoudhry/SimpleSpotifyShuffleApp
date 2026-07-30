import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import { assertClientIdConfigured, REDIRECT_URI, SCOPES, SPOTIFY_CLIENT_ID } from './config';
import { clearLikedSongsCache } from './likedSongsCache';
import { clearAppRemoteToken } from './spotifyPlayer';

const DISCOVERY = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

const ACCESS_TOKEN_KEY = 'spotify_access_token';
const REFRESH_TOKEN_KEY = 'spotify_refresh_token';
const EXPIRES_AT_KEY = 'spotify_expires_at';
const EXPIRY_BUFFER_MS = 60_000;

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

async function storeTokens(tokens: TokenSet): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
    SecureStore.setItemAsync(EXPIRES_AT_KEY, String(tokens.expiresAt)),
  ]);
}

async function loadTokens(): Promise<TokenSet | null> {
  const [accessToken, refreshToken, expiresAtRaw] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.getItemAsync(EXPIRES_AT_KEY),
  ]);
  if (!accessToken || !refreshToken || !expiresAtRaw) return null;
  return { accessToken, refreshToken, expiresAt: Number(expiresAtRaw) };
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(EXPIRES_AT_KEY),
    // Otherwise the next account to log in would inherit this library or session.
    clearLikedSongsCache(),
    clearAppRemoteToken(),
  ]);
}

export async function isLoggedIn(): Promise<boolean> {
  return (await loadTokens()) !== null;
}

export async function login(): Promise<void> {
  assertClientIdConfigured();

  const request = new AuthSession.AuthRequest({
    clientId: SPOTIFY_CLIENT_ID,
    scopes: SCOPES,
    redirectUri: REDIRECT_URI,
    usePKCE: true,
    responseType: AuthSession.ResponseType.Code,
  });

  const result = await request.promptAsync(DISCOVERY);

  if (result.type !== 'success' || !result.params.code) {
    throw new Error('Spotify login was cancelled.');
  }
  if (!request.codeVerifier) {
    throw new Error('Missing PKCE code verifier.');
  }

  const tokenResponse = await AuthSession.exchangeCodeAsync(
    {
      clientId: SPOTIFY_CLIENT_ID,
      code: result.params.code,
      redirectUri: REDIRECT_URI,
      extraParams: { code_verifier: request.codeVerifier },
    },
    DISCOVERY
  );

  if (!tokenResponse.refreshToken) {
    throw new Error('Spotify did not return a refresh token.');
  }

  await storeTokens({
    accessToken: tokenResponse.accessToken,
    refreshToken: tokenResponse.refreshToken,
    expiresAt: Date.now() + (tokenResponse.expiresIn ?? 3600) * 1000,
  });
}

async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  const tokenResponse = await AuthSession.refreshAsync(
    { clientId: SPOTIFY_CLIENT_ID, refreshToken },
    DISCOVERY
  );

  const tokens: TokenSet = {
    accessToken: tokenResponse.accessToken,
    refreshToken: tokenResponse.refreshToken ?? refreshToken,
    expiresAt: Date.now() + (tokenResponse.expiresIn ?? 3600) * 1000,
  };

  await storeTokens(tokens);
  return tokens;
}

export async function getValidAccessToken(): Promise<string> {
  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error('Not connected to Spotify.');
  }
  if (Date.now() < tokens.expiresAt - EXPIRY_BUFFER_MS) {
    return tokens.accessToken;
  }
  const refreshed = await refreshTokens(tokens.refreshToken);
  return refreshed.accessToken;
}

/**
 * Refreshes regardless of the locally-tracked expiry.
 *
 * A token can be rejected server-side while still looking valid here — for
 * example after re-authorizing with a different scope set, which is exactly
 * when the stored token silently stops working. Callers use this to recover
 * from a 401 rather than surfacing it to the user.
 */
export async function forceRefreshAccessToken(): Promise<string> {
  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error('Not connected to Spotify.');
  }
  const refreshed = await refreshTokens(tokens.refreshToken);
  return refreshed.accessToken;
}
