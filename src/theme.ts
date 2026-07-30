// React Native's style system has no oklch() support, so colors from the
// design are converted to sRGB hex ahead of time using the same OKLCH->sRGB
// math the browser uses (Björn Ottosson's reference formulas), rather than
// eyeballed approximations.
function oklchToHex(L: number, C: number, hueDeg: number): string {
  const h = (hueDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const toChannel = (c: number) => {
    const gamma = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(gamma * 255)));
  };

  return (
    '#' +
    [r, g, bl]
      .map(toChannel)
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
  );
}

// Precomputed from the design's fixed oklch(L C 270) tokens — these don't
// vary per track, so there's no need to recompute them at render time.
export const colors = {
  pageBackground: '#08090c',
  nearWhite: '#f2f5fc',
  iconMuted: '#9c9ea5',
  secondaryText: '#84868c',
  vinylIcon: '#a9aebb',
  timeLabel: '#6f7178',
  progressTrack: '#313338',
  transportIcon: '#eceef5',
  error: '#f15e6c',
} as const;

// The design varies album-art color per track via an arbitrary demo `hue`
// field. Real tracks carry no color data over App Remote, so the hue is
// derived from the track URI instead — deterministic per track, and
// visually distinct between tracks, without claiming to be real album art.
function hashHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

export function trackColors(trackUri: string | null) {
  const hue = trackUri ? hashHue(trackUri) : 270;
  return {
    accent: oklchToHex(0.78, 0.14, hue),
    gradientTop: oklchToHex(0.34, 0.05, hue),
    gradientBottom: oklchToHex(0.2, 0.03, hue),
  };
}
