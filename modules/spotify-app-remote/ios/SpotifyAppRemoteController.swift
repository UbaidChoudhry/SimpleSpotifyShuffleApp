import ExpoModulesCore
import SpotifyiOS

// A singleton because the JS-facing Module object is recreated on every JS
// reload, but the SDK connection and the AppDelegate URL handshake must not
// be — mirrors ExpoLinkingRegistry's pattern in expo-linking.
final class SpotifyAppRemoteController: NSObject {
  static let shared = SpotifyAppRemoteController()

  var onPlayerState: (([String: Any?]) -> Void)?
  var onConnectionState: (([String: Any?]) -> Void)?
  var onAccessToken: ((String) -> Void)?

  private var appRemote: SPTAppRemote?
  private var redirectHost: String?
  // fetchImage needs the actual track object (it conforms to
  // SPTAppRemoteImageRepresentable), not just the serialized dict handed to
  // JS — kept in sync with the last player-state push.
  private var currentTrack: (any SPTAppRemoteTrack)?
  // `connect()` only succeeds if Spotify is already running in the
  // background — unlike authorizeAndPlayURI, it cannot wake the app — and it
  // reports success/failure asynchronously via the delegate, not a callback.
  // This lets connectWithAccessToken's promise reflect the real outcome
  // instead of resolving the instant connect() is called.
  private var pendingConnectPromise: Promise?

  func clearListeners() {
    onPlayerState = nil
    onConnectionState = nil
    onAccessToken = nil
  }

  func configure(clientId: String, redirectUri: String) {
    guard let url = URL(string: redirectUri) else { return }
    redirectHost = url.host
    let remote = SPTAppRemote(configuration: SPTConfiguration(clientID: clientId, redirectURL: url), logLevel: .info)
    remote.delegate = self
    appRemote = remote
  }

  func isSpotifyInstalled() -> Bool {
    guard let url = URL(string: "spotify:") else { return false }
    return UIApplication.shared.canOpenURL(url)
  }

  func authorizeAndPlay(uri: String, promise: Promise) {
    guard let appRemote else {
      promise.reject("ERR_NOT_CONFIGURED", "Call configure() first.")
      return
    }
    appRemote.authorizeAndPlayURI(uri) { spotifyInstalled in
      promise.resolve(spotifyInstalled)
    }
  }

  func connectWithAccessToken(_ token: String, promise: Promise) {
    guard let appRemote else {
      promise.reject("ERR_NOT_CONFIGURED", "Call configure() first.")
      return
    }
    pendingConnectPromise = promise
    appRemote.connectionParameters.accessToken = token
    appRemote.connect()
  }

  func disconnect() {
    appRemote?.disconnect()
  }

  func disconnect(promise: Promise) {
    appRemote?.disconnect()
    promise.resolve(nil)
  }

  func play(uri: String, promise: Promise) {
    appRemote?.playerAPI?.play(uri, callback: bridge(promise))
  }

  func resume(promise: Promise) {
    appRemote?.playerAPI?.resume(bridge(promise))
  }

  func pause(promise: Promise) {
    appRemote?.playerAPI?.pause(bridge(promise))
  }

  func skipNext(promise: Promise) {
    appRemote?.playerAPI?.skip(toNext: bridge(promise))
  }

  func skipPrevious(promise: Promise) {
    appRemote?.playerAPI?.skip(toPrevious: bridge(promise))
  }

  func seekTo(positionMs: Int, promise: Promise) {
    appRemote?.playerAPI?.seek(toPosition: positionMs, callback: bridge(promise))
  }

  func setShuffle(_ enabled: Bool, promise: Promise) {
    appRemote?.playerAPI?.setShuffle(enabled, callback: bridge(promise))
  }

  func setRepeatMode(_ mode: String, promise: Promise) {
    let repeatMode: SPTAppRemotePlaybackOptionsRepeatMode
    switch mode {
    case "track": repeatMode = .track
    case "context": repeatMode = .context
    default: repeatMode = .off
    }
    appRemote?.playerAPI?.setRepeatMode(repeatMode, callback: bridge(promise))
  }

  func addToLibrary(uri: String, promise: Promise) {
    appRemote?.userAPI?.addItemToLibrary(withURI: uri, callback: libraryBridge(promise))
  }

  func removeFromLibrary(uri: String, promise: Promise) {
    appRemote?.userAPI?.removeItemFromLibrary(withURI: uri, callback: libraryBridge(promise))
  }

  func fetchLibraryState(uri: String, promise: Promise) {
    appRemote?.userAPI?.fetchLibraryState(forURI: uri, callback: libraryBridge(promise))
  }

  func fetchAlbumArt(width: Int, height: Int, promise: Promise) {
    guard let appRemote, let currentTrack else {
      promise.resolve(nil)
      return
    }
    let size = CGSize(width: CGFloat(width), height: CGFloat(height))
    appRemote.imageAPI?.fetchImage(forItem: currentTrack, with: size) { result, error in
      if let error {
        promise.reject("ERR_SPOTIFY", error.localizedDescription)
      } else if let image = result as? UIImage, let data = image.jpegData(compressionQuality: 0.85) {
        promise.resolve("data:image/jpeg;base64," + data.base64EncodedString())
      } else {
        promise.resolve(nil)
      }
    }
  }

  func getPlayerState(promise: Promise) {
    appRemote?.playerAPI?.getPlayerState { [weak self] result, error in
      if let error {
        promise.reject("ERR_SPOTIFY", error.localizedDescription)
      } else if let state = result as? SPTAppRemotePlayerState {
        self?.currentTrack = state.track
        promise.resolve(serialize(state))
      } else {
        promise.resolve(nil)
      }
    }
  }

  /// Invoked from the AppDelegate subscriber when a URL comes in.
  @discardableResult
  func handleOpen(url: URL) -> Bool {
    guard let appRemote, url.host == redirectHost,
          let params = appRemote.authorizationParameters(from: url) else { return false }

    if let token = params[SPTAppRemoteAccessTokenKey] {
      appRemote.connectionParameters.accessToken = token
      onAccessToken?(token)
      appRemote.connect()
      return true
    }
    if let description = params[SPTAppRemoteErrorDescriptionKey] {
      onConnectionState?(["state": "disconnected", "error": description])
      return true
    }
    return false
  }

  // SPTAppRemoteCallback is (id?, NSError?) -> Void, not Promise-native.
  private func bridge(_ promise: Promise) -> SPTAppRemoteCallback {
    return { _, error in
      if let error {
        promise.reject("ERR_SPOTIFY", error.localizedDescription)
      } else {
        promise.resolve(nil)
      }
    }
  }

  private func libraryBridge(_ promise: Promise) -> SPTAppRemoteCallback {
    return { result, error in
      if let error {
        promise.reject("ERR_SPOTIFY", error.localizedDescription)
      } else if let state = result as? SPTAppRemoteLibraryState {
        promise.resolve(serialize(state))
      } else {
        promise.resolve(nil)
      }
    }
  }
}

extension SpotifyAppRemoteController: SPTAppRemoteDelegate {
  func appRemoteDidEstablishConnection(_ appRemote: SPTAppRemote) {
    appRemote.playerAPI?.delegate = self
    appRemote.playerAPI?.subscribe(toPlayerState: nil)
    // Enforces the project's own "play with Spotify shuffle off" invariant,
    // since this app's shuffling already happens server-side via playlist order.
    appRemote.playerAPI?.setShuffle(false, callback: nil)
    onConnectionState?(["state": "connected"])
    pendingConnectPromise?.resolve(nil)
    pendingConnectPromise = nil
  }

  func appRemote(_ appRemote: SPTAppRemote, didFailConnectionAttemptWithError error: Error?) {
    // A connection we asked for and didn't get. The waiting promise decides
    // whether this is worth showing — an auto-reconnect swallows it.
    onConnectionState?(["state": "disconnected", "error": error?.localizedDescription])
    pendingConnectPromise?.reject("ERR_CONNECTION_FAILED", error?.localizedDescription ?? "Connection failed.")
    pendingConnectPromise = nil
  }

  func appRemote(_ appRemote: SPTAppRemote, didDisconnectWithError error: Error?) {
    // Routine: Spotify drops the socket whenever it suspends, which happens on
    // backgrounding and after a short idle with playback paused. Deliberately
    // carries no `error` — surfacing it showed users "connection terminated"
    // for something entirely expected.
    onConnectionState?(["state": "disconnected"])
  }
}

extension SpotifyAppRemoteController: SPTAppRemotePlayerStateDelegate {
  func playerStateDidChange(_ playerState: SPTAppRemotePlayerState) {
    currentTrack = playerState.track
    onPlayerState?(serialize(playerState))
  }
}
