import { colors } from "@/theme/paint";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import { ReadLoadingState } from "@/components/read-loading-indicator";

import { ExperienceOpeningProvider, monotonicNow } from "@/renderers/experience-opening";
import { renderAppView } from "@/renderers/registry";
import { useAppView } from "@/renderers/use-app-view";
import { useExperienceBootstrapActivity } from "@/renderers/use-experience-activity";

export default function AppViewScreen() {
  const [routeStartedAt] = useState(monotonicNow);
  const { appViewId } = useLocalSearchParams<{ appViewId: string }>();
  const { appView, error, isLoading, retry } = useAppView(appViewId);
  useExperienceBootstrapActivity(appViewId, {
    enabled: !appView,
    errorCode: error ? "APP_VIEW_LOAD_FAILED" : null,
    isLoading,
  });

  if (isLoading) {
    return (
      <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
        <ReadLoadingState mode="initial" />
      </ScrollView>
    );
  }

  if (error || !appView) {
    return (
      <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
        <Text style={styles.error}>{error ?? "No fue posible cargar la experiencia."}</Text>
        <Pressable onPress={retry} style={styles.retryButton}>
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return <ExperienceOpeningProvider routeStartedAt={routeStartedAt}>{renderAppView(appView)}</ExperienceOpeningProvider>;
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    padding: 20,
  },
  error: {
    color: colors.danger,
    lineHeight: 20,
  },
  retryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  retryText: {
    color: colors.onPrimary,
    fontWeight: "800",
  },
  screen: {
    backgroundColor: colors.canvas,
    flex: 1,
  },
});
