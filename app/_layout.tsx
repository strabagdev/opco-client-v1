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
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </SessionProvider>
  );
}
