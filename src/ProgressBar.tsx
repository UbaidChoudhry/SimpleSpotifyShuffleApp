import { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { colors } from './theme';

// A native OS slider (e.g. @react-native-community/slider) renders as a
// pill-shaped track with a large thumb — it can't be styled down to this
// design's 4px hairline track, so this is a small hand-rolled scrubber
// instead. The thumb keeps a 24px touch target even though it renders at 12px,
// matching the source design's own invisible-hit-area technique.
export function ProgressBar({
  progress,
  accentColor,
  onSeek,
}: {
  progress: number; // 0–1
  accentColor: string;
  onSeek: (progress: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragProgress, setDragProgress] = useState<number | null>(null);
  const trackWidthRef = useRef(0);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          if (trackWidthRef.current > 0) {
            setDragProgress(clamp(e.nativeEvent.locationX / trackWidthRef.current));
          }
        },
        onPanResponderMove: (e) => {
          if (trackWidthRef.current > 0) {
            setDragProgress(clamp(e.nativeEvent.locationX / trackWidthRef.current));
          }
        },
        onPanResponderRelease: (e) => {
          if (trackWidthRef.current > 0) {
            const final = clamp(e.nativeEvent.locationX / trackWidthRef.current);
            onSeek(final);
          }
          setDragProgress(null);
        },
        onPanResponderTerminate: () => setDragProgress(null),
      }),
    [onSeek]
  );

  const shownProgress = dragProgress ?? progress;

  return (
    <View
      style={styles.hitArea}
      onLayout={(e) => {
        setTrackWidth(e.nativeEvent.layout.width);
        trackWidthRef.current = e.nativeEvent.layout.width;
      }}
      {...panResponder.panHandlers}
    >
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${shownProgress * 100}%`, backgroundColor: accentColor }]} />
        <View
          style={[
            styles.thumb,
            { left: `${shownProgress * 100}%` },
            dragProgress != null && styles.thumbActive,
          ]}
        />
      </View>
    </View>
  );
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

const styles = StyleSheet.create({
  hitArea: { width: '100%', height: 24, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.progressTrack, width: '100%' },
  fill: { position: 'absolute', top: 0, left: 0, height: 4, borderRadius: 2 },
  thumb: {
    position: 'absolute',
    top: '50%',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.nearWhite,
    marginLeft: -6,
    marginTop: -6,
  },
  thumbActive: { transform: [{ scale: 1.2 }] },
});
