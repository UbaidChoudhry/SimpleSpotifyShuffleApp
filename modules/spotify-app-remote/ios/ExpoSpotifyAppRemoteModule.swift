import ExpoModulesCore

public class ExpoSpotifyAppRemoteModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoSpotifyAppRemote")

    Events("onPlayerStateChange", "onConnectionStateChange", "onAccessToken")

    OnCreate {
      SpotifyAppRemoteController.shared.onPlayerState = { [weak self] payload in
        self?.sendEvent("onPlayerStateChange", payload)
      }
      SpotifyAppRemoteController.shared.onConnectionState = { [weak self] payload in
        self?.sendEvent("onConnectionStateChange", payload)
      }
      SpotifyAppRemoteController.shared.onAccessToken = { [weak self] token in
        self?.sendEvent("onAccessToken", ["accessToken": token])
      }
    }

    OnDestroy {
      SpotifyAppRemoteController.shared.clearListeners()
      SpotifyAppRemoteController.shared.disconnect()
    }

    OnAppEntersBackground {
      SpotifyAppRemoteController.shared.disconnect()
    }

    Function("configure") { (clientId: String, redirectUri: String) in
      SpotifyAppRemoteController.shared.configure(clientId: clientId, redirectUri: redirectUri)
    }

    // Requires UIApplication.shared.canOpenURL, which is main-thread-only —
    // a sync Function would run on the calling JS thread instead.
    AsyncFunction("isSpotifyInstalled") { () -> Bool in
      SpotifyAppRemoteController.shared.isSpotifyInstalled()
    }.runOnQueue(.main)

    AsyncFunction("authorizeAndPlay") { (uri: String, promise: Promise) in
      SpotifyAppRemoteController.shared.authorizeAndPlay(uri: uri, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("connectWithAccessToken") { (token: String, promise: Promise) in
      SpotifyAppRemoteController.shared.connectWithAccessToken(token, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("disconnect") { (promise: Promise) in
      SpotifyAppRemoteController.shared.disconnect(promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("play") { (uri: String, promise: Promise) in
      SpotifyAppRemoteController.shared.play(uri: uri, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("resume") { (promise: Promise) in
      SpotifyAppRemoteController.shared.resume(promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("pause") { (promise: Promise) in
      SpotifyAppRemoteController.shared.pause(promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("skipNext") { (promise: Promise) in
      SpotifyAppRemoteController.shared.skipNext(promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("skipPrevious") { (promise: Promise) in
      SpotifyAppRemoteController.shared.skipPrevious(promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("seekTo") { (positionMs: Int, promise: Promise) in
      SpotifyAppRemoteController.shared.seekTo(positionMs: positionMs, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("setShuffle") { (enabled: Bool, promise: Promise) in
      SpotifyAppRemoteController.shared.setShuffle(enabled, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("setRepeatMode") { (mode: String, promise: Promise) in
      SpotifyAppRemoteController.shared.setRepeatMode(mode, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("addToLibrary") { (uri: String, promise: Promise) in
      SpotifyAppRemoteController.shared.addToLibrary(uri: uri, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("removeFromLibrary") { (uri: String, promise: Promise) in
      SpotifyAppRemoteController.shared.removeFromLibrary(uri: uri, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("fetchLibraryState") { (uri: String, promise: Promise) in
      SpotifyAppRemoteController.shared.fetchLibraryState(uri: uri, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("getPlayerState") { (promise: Promise) in
      SpotifyAppRemoteController.shared.getPlayerState(promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("fetchAlbumArt") { (width: Int, height: Int, promise: Promise) in
      SpotifyAppRemoteController.shared.fetchAlbumArt(width: width, height: height, promise: promise)
    }.runOnQueue(.main)
  }
}
