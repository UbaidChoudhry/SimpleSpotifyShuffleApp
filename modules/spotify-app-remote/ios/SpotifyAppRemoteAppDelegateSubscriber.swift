import ExpoModulesCore

public class SpotifyAppRemoteAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    SpotifyAppRemoteController.shared.handleOpen(url: url)
  }
}
