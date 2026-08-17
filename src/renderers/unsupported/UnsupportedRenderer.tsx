import { StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/app-icon";
import { getAppViewTypeLabel } from "@/lib/app-views";
import { AppViewRendererProps } from "@/renderers/types";

export function UnsupportedRenderer({ appView }: AppViewRendererProps) {
  return (
    <View style={styles.content}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <AppIcon icon={appView.icon} size={26} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{appView.name}</Text>
          <Text style={styles.meta}>{getAppViewTypeLabel(appView.type)}</Text>
        </View>
      </View>
      <Text style={styles.message}>Esta experiencia todavia no esta disponible en esta version de Opco Client.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    padding: 20,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
  },
  headerText: {
    flex: 1,
  },
  icon: {
    alignItems: "center",
    backgroundColor: "#e4f1f2",
    borderRadius: 8,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  message: {
    color: "#587078",
    fontSize: 16,
    lineHeight: 22,
  },
  meta: {
    color: "#587078",
    marginTop: 3,
  },
  title: {
    color: "#0f3036",
    fontSize: 26,
    fontWeight: "800",
  },
});
