import { useSyncExternalStore } from "react";
import { Platform, Text, View } from "react-native";
import { CompactSelect } from "../components/compact-select";
import { colors } from "./paint";

type Preference = "auto" | "light" | "dark";
type Snapshot = Readonly<{ preference: Preference; resolved: "light" | "dark"; persistence: "available" | "persisted" | "unavailable" }>;
type Controller = { getSnapshot(): Snapshot; subscribe(listener: () => void): () => void; setPreference(value: Preference): boolean };
declare global { interface Window { __opcoTheme?: Controller } }
const fallback: Snapshot = { preference: "light", resolved: "light", persistence: "unavailable" };
const serverSnapshot = () => fallback;
const subscribe = (listener: () => void) => typeof window === "undefined" ? () => {} : window.__opcoTheme?.subscribe(listener) ?? (() => {});
const getSnapshot = () => typeof window === "undefined" ? fallback : window.__opcoTheme?.getSnapshot() ?? fallback;

/** Kept outside session/context: changing appearance cannot invalidate operational scopes. */
export function ThemeSelection() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  if (Platform.OS !== "web" || typeof window === "undefined" || !window.__opcoTheme) return null;
  return <View style={{ gap: 8 }}>
    <Text style={{ color: colors.textSecondary, fontWeight: "700", fontSize: 13 }}>Apariencia</Text>
    <CompactSelect label="Tema de la aplicación" value={theme.preference} required options={[
      { value: "auto", label: "Automático · seguir el sistema" }, { value: "light", label: "Claro" }, { value: "dark", label: "Oscuro" },
    ]} onChange={value => { if (typeof value === "string" && ["auto", "light", "dark"].includes(value)) window.__opcoTheme?.setPreference(value as Preference); }} />
    {theme.persistence === "unavailable" ? <Text accessibilityRole="alert" style={{ color: colors.warning, fontSize: 14 }}>El tema se aplica en esta ventana, pero el navegador no permite guardar la preferencia.</Text> : null}
  </View>;
}
