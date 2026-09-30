import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from "react-native";

type ReadLoadingIndicatorProps = {
  mode: "initial" | "refresh";
};

const SEGMENT_RATIO = 0.32;

export function ReadLoadingIndicator({ mode }: ReadLoadingIndicatorProps) {
  const [progress] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const label = mode === "initial" ? "Cargando…" : "Actualizando…";

  useEffect(() => {
    let mounted = true;
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    progress.stopAnimation();
    progress.setValue(0);

    if (reduceMotion || trackWidth <= 0) return;

    const animation = Animated.loop(
      Animated.timing(progress, {
        duration: 1_150,
        easing: Easing.inOut(Easing.ease),
        toValue: 1,
        useNativeDriver: false,
      }),
    );

    animation.start();
    return () => {
      animation.stop();
      progress.setValue(0);
    };
  }, [progress, reduceMotion, trackWidth]);

  const segmentWidth = Math.max(24, trackWidth * SEGMENT_RATIO);
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-segmentWidth, trackWidth],
  });

  function handleTrackLayout(event: LayoutChangeEvent) {
    setTrackWidth(event.nativeEvent.layout.width);
  }

  return (
    <View
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessible
      style={[
        styles.container,
        mode === "refresh" ? styles.refreshContainer : styles.initialContainer,
      ]}
    >
      <View onLayout={handleTrackLayout} style={styles.track}>
        <Animated.View
          style={[
            styles.segment,
            {
              opacity: reduceMotion ? 0.72 : 1,
              transform: [{ translateX }],
              width: segmentWidth,
            },
          ]}
        />
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: "stretch",
    gap: 6,
  },
  initialContainer: {
    justifyContent: "center",
    minHeight: 84,
  },
  label: {
    color: "#587078",
    fontSize: 13,
    lineHeight: 18,
  },
  refreshContainer: {
    minHeight: 28,
  },
  segment: {
    backgroundColor: "#13795b",
    borderRadius: 2,
    height: 3,
  },
  track: {
    backgroundColor: "#d9e3e5",
    borderRadius: 2,
    height: 3,
    overflow: "hidden",
  },
});
