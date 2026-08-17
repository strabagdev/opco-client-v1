import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text } from "react-native";

import { renderAppView } from "@/renderers/registry";
import { useAppView } from "@/renderers/use-app-view";

export default function AppViewScreen() {
  const { appViewId } = useLocalSearchParams<{ appViewId: string }>();
  const { appView, error, isLoading, retry } = useAppView(appViewId);

  if (isLoading) {
    return (
      <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
        <ActivityIndicator />
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

  return renderAppView(appView);
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    padding: 20,
  },
  error: {
    color: "#b42318",
    lineHeight: 20,
  },
  retryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#135d66",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  retryText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  screen: {
    backgroundColor: "#eef4f4",
    flex: 1,
  },
});
