const { withInfoPlist, withPodfileProperties, createRunOncePlugin } = require('@expo/config-plugins');

// Registered separately from our own module's podspec because local Expo
// modules autolink as `:path` pods, and CocoaPods ignores `spec.source`
// entirely for `:path` pods — the vendored SDK would silently never download.
const SPOTIFY_POD = {
  name: 'SpotifyiOS',
  podspec: '../modules/spotify-app-remote/vendor/SpotifyiOS.podspec',
};

const withSpotifyAppRemote = (config) => {
  config = withInfoPlist(config, (config) => {
    // Required for canOpenURL("spotify:") to ever return true.
    const schemes = config.modResults.LSApplicationQueriesSchemes ?? [];
    if (!schemes.includes('spotify')) schemes.push('spotify');
    config.modResults.LSApplicationQueriesSchemes = schemes;
    return config;
  });

  config = withPodfileProperties(config, (config) => {
    // apple.extraPods is stored as a JSON-encoded string, not a native array.
    const existing = JSON.parse(config.modResults['apple.extraPods'] ?? '[]');
    if (!existing.some((p) => p.name === SPOTIFY_POD.name)) existing.push(SPOTIFY_POD);
    config.modResults['apple.extraPods'] = JSON.stringify(existing);
    return config;
  });

  return config;
};

module.exports = createRunOncePlugin(withSpotifyAppRemote, 'spotify-app-remote', '1.0.0');
