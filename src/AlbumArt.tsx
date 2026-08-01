import { useCallback, useMemo, useRef } from 'react';
import { Animated, Image, PanResponder, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { VinylIcon } from './icons';
import { colors } from './theme';

// Below this the touch is still a tap (or the start of one) and the gesture is
// left alone, so the art can gain a press handler later without fighting this.
const CLAIM_THRESHOLD = 8;
// Far enough that a shaky finger can't skip a track by accident.
const SWIPE_DISTANCE_THRESHOLD = 56;
// A quick flick counts as well, but only once it has covered enough ground to
// be a deliberate direction rather than a jittery release.
const FLICK_VELOCITY_THRESHOLD = 0.35;
const FLICK_DISTANCE_THRESHOLD = 24;
// The art trails the finger instead of tracking it 1:1. This is a direction
// hint, not a drag-to-position control, and the resistance reads as "this
// snaps back" rather than "this is now stuck where I dropped it."
const DRAG_DAMPING = 0.55;

export function AlbumArt({
  uri,
  gradientTop,
  gradientBottom,
  onSwipeNext,
  onSwipePrevious,
}: {
  uri: string | null;
  gradientTop: string;
  gradientBottom: string;
  onSwipeNext: () => void;
  onSwipePrevious: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;

  // The art always returns home rather than animating out with the swipe: the
  // replacement image is fetched asynchronously after the track actually
  // changes, so a hand-off animation would be sliding in the old artwork.
  const settle = useCallback(() => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 6 }).start();
  }, [translateX]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > CLAIM_THRESHOLD && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_event, gesture) => translateX.setValue(gesture.dx * DRAG_DAMPING),
        onPanResponderRelease: (_event, gesture) => {
          const travelled = Math.abs(gesture.dx);
          const committed =
            travelled > SWIPE_DISTANCE_THRESHOLD ||
            (travelled > FLICK_DISTANCE_THRESHOLD && Math.abs(gesture.vx) > FLICK_VELOCITY_THRESHOLD);
          if (committed) {
            // Dragging left pushes the current track off to the left and pulls
            // the next one in behind it, matching the direction a queue moves.
            if (gesture.dx < 0) onSwipeNext();
            else onSwipePrevious();
          }
          settle();
        },
        onPanResponderTerminate: settle,
      }),
    [onSwipeNext, onSwipePrevious, settle, translateX]
  );

  return (
    // The gesture lives on the surrounding band, not on the artwork itself: a
    // responder sized exactly to the 260pt image is a small target, and a swipe
    // that starts just off the edge of the art is one a user reasonably expects
    // to work. The artwork is marked pointerEvents="none" so every touch in the
    // band lands here directly instead of being negotiated with the Image (or,
    // for the placeholder, the SVG inside the gradient).
    <View style={styles.hitArea} {...panResponder.panHandlers}>
      <Animated.View style={{ transform: [{ translateX }] }} pointerEvents="none">
        {uri != null ? (
          <Image source={{ uri }} style={styles.art} />
        ) : (
          <LinearGradient
            colors={[gradientTop, gradientBottom]}
            start={{ x: 0.3, y: 0 }}
            end={{ x: 0.7, y: 1 }}
            style={styles.art}
          >
            <VinylIcon size={26} color={colors.vinylIcon} />
          </LinearGradient>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  hitArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  art: {
    width: 260,
    height: 260,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 60,
    shadowOffset: { width: 0, height: 24 },
    elevation: 12,
  },
});
