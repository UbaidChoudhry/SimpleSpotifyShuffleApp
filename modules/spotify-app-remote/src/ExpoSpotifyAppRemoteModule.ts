import { NativeModule, requireNativeModule } from 'expo-modules-core';
import type { NativePlayerState, ConnectionEvent, LibraryState, RepeatMode } from './ExpoSpotifyAppRemote.types';

type Events = {
  onPlayerStateChange: (state: NativePlayerState) => void;
  onConnectionStateChange: (event: ConnectionEvent) => void;
  onAccessToken: (event: { accessToken: string }) => void;
};

declare class ExpoSpotifyAppRemoteModule extends NativeModule<Events> {
  configure(clientId: string, redirectUri: string): void;
  isSpotifyInstalled(): Promise<boolean>;
  authorizeAndPlay(uri: string): Promise<boolean>;
  connectWithAccessToken(accessToken: string): Promise<void>;
  disconnect(): Promise<void>;
  play(uri: string): Promise<void>;
  resume(): Promise<void>;
  pause(): Promise<void>;
  skipNext(): Promise<void>;
  skipPrevious(): Promise<void>;
  seekTo(positionMs: number): Promise<void>;
  setShuffle(enabled: boolean): Promise<void>;
  setRepeatMode(mode: RepeatMode): Promise<void>;
  addToLibrary(uri: string): Promise<LibraryState | null>;
  removeFromLibrary(uri: string): Promise<LibraryState | null>;
  fetchLibraryState(uri: string): Promise<LibraryState | null>;
  getPlayerState(): Promise<NativePlayerState | null>;
  /** Resolves to a `data:image/jpeg;base64,...` URI, or null if unavailable. */
  fetchAlbumArt(width: number, height: number): Promise<string | null>;
}

export default requireNativeModule<ExpoSpotifyAppRemoteModule>('ExpoSpotifyAppRemote');
