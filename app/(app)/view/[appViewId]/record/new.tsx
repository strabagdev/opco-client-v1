import { ReadLoadingState } from "@/components/read-loading-indicator";
import { useExperienceBootstrapActivity } from "@/renderers/use-experience-activity";
import { useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import { RecordFormScreen } from "@/renderers/records/RecordFormScreen";
import { UnsupportedRenderer } from "@/renderers/unsupported/UnsupportedRenderer";
import { useAppView } from "@/renderers/use-app-view";

export default function NewAppViewRecordRoute() {
  const { appViewId } = useLocalSearchParams<{ appViewId: string }>();
  const { appView, error, isLoading, retry } = useAppView(appViewId);
  useExperienceBootstrapActivity(appViewId, { enabled: !appView, errorCode: error ? "APP_VIEW_LOAD_FAILED" : null, isLoading });

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

  if (appView.type !== "RECORDS") {
    return <UnsupportedRenderer appView={appView} />;
  }

  return <RecordFormScreen appView={appView} mode="create" />;
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
