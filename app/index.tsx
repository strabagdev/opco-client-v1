import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useSession } from "@/state/session";

export default function IndexRoute() {
  const { status } = useSession();

  if (status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return <Redirect href={status === "authenticated" || status === "offline" ? "/(app)" : "/(auth)/login"} />;
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
});
