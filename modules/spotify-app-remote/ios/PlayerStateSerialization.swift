import SpotifyiOS

func repeatModeString(_ mode: SPTAppRemotePlaybackOptionsRepeatMode) -> String {
  switch mode {
  case .off: return "off"
  case .track: return "track"
  case .context: return "context"
  @unknown default: return "off"
  }
}

func serialize(_ state: SPTAppRemotePlayerState) -> [String: Any?] {
  let track = state.track
  return [
    "track": [
      "uri": track.uri,
      "name": track.name,
      "artistName": track.artist.name,
      "albumName": track.album.name,
      "durationMs": track.duration,
      "isAdvertisement": track.isAdvertisement,
      "isSaved": track.isSaved,
    ],
    "isPaused": state.isPaused,
    "positionMs": state.playbackPosition,
    "playbackSpeed": state.playbackSpeed,
    "contextUri": state.contextURI.absoluteString,
    "isShuffling": state.playbackOptions.isShuffling,
    "repeatMode": repeatModeString(state.playbackOptions.repeatMode),
  ]
}

func serialize(_ libraryState: SPTAppRemoteLibraryState) -> [String: Any?] {
  return ["uri": libraryState.uri, "isAdded": libraryState.isAdded, "canAdd": libraryState.canAdd]
}
