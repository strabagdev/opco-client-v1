import { useEffect, useState } from "react";
import { typography } from "../theme/tokens";
import { colors } from "../theme/paint";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";

// Only the shell animates reads. The initial body and PANEL module states are static.
export function ReadLoadingState({ compact = false, mode }: { compact?: boolean; mode: "initial" | "refresh" }) {
  return <View style={[styles.container, compact ? styles.compact : null]}>
    <Text style={styles.label}>{mode === "initial" ? "Esperando datos…" : "Actualizando este módulo…"}</Text>
  </View>;
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let mounted = true;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted) setReduced(value);
    }).catch(() => undefined);
    return () => { mounted = false; subscription.remove(); };
  }, []);
  return reduced;
}

const styles = StyleSheet.create({
  container: { justifyContent: "center", minHeight: 64 },
  compact: { minHeight: 28 },
  label: { color: colors.textSecondary, ...typography.meta },
});
