Pod::Spec.new do |s|
  s.name          = 'SpotifyiOS'
  s.version       = '5.0.1'
  s.summary       = 'Spotify iOS SDK (App Remote)'
  s.homepage      = 'https://github.com/spotify/ios-sdk'
  s.license       = { :type => 'Spotify Developer Terms', :text => 'See https://developer.spotify.com/terms' }
  s.author        = 'Spotify AB'
  s.platforms     = { :ios => '12.0' }
  s.source        = { :git => 'https://github.com/spotify/ios-sdk.git', :tag => 'v5.0.1' }
  s.vendored_frameworks = 'SpotifyiOS.xcframework'
end
