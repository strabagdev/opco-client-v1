import { colors } from "@/theme/paint";
import { KeyboardFocusStyles } from "@/components/keyboard-focus";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { registerOfflineAppShell } from "@/lib/pwa";
import { SessionProvider } from "@/state/session";

export default function RootLayout() {
  useEffect(() => {
    registerOfflineAppShell();
  }, []);

  return (
    <SessionProvider>
      <KeyboardFocusStyles />
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />
    </SessionProvider>
  );
}
