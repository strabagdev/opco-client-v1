import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useSession } from "@/state/session";

export default function AppLayout() {
  const { status } = useSession();

  if (status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (status === "anonymous") {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#eef4f4" },
        headerTintColor: "#0f3036",
      }}
    >
      <Stack.Screen name="index" options={{ title: "Opco" }} />
      <Stack.Screen name="entity/[entityTypeId]" options={{ title: "Registros" }} />
      <Stack.Screen name="entity/[entityTypeId]/record/[recordId]" options={{ title: "Detalle" }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
});
