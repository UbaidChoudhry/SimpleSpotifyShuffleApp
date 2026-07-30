export type RepeatMode = 'off' | 'track' | 'context';

export type NativeTrack = {
  uri: string;
  name: string;
  artistName: string;
  albumName: string;
  durationMs: number;
  isAdvertisement: boolean;
  isSaved: boolean;
};

export type NativePlayerState = {
  track: NativeTrack | null;
  isPaused: boolean;
  positionMs: number;
  playbackSpeed: number;
  contextUri: string | null;
  isShuffling: boolean;
  repeatMode: RepeatMode;
};

export type ConnectionEvent = {
  state: 'connected' | 'disconnected';
  error?: string;
};

export type LibraryState = {
  uri: string;
  isAdded: boolean;
  canAdd: boolean;
};
