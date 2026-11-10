import { actionSurface } from "../theme/operational-presentation";
import { type ThemeColors } from "../theme/tokens";
import { colors } from "../theme/paint";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAssignedAppViews } from "./desktop-navigation";
import { desktopNavigation } from "../lib/desktop-navigation";
import { appViewIdFromPathname } from "../lib/write-feedback";

type Props = {
  pathname: string;
  contractName?: string;
  fallbackTitle?: string | null;
  category?: unknown;
  width: number;
  wide: boolean;
  status: ReactNode;
  menu: ReactNode;
  onBack(): void;
};

/** One header tree at every width: styling never remounts the workflow or changes its scope. */
export function AppShellHeader({ pathname, contractName, fallbackTitle, category, width, wide, status, menu, onBack }: Props) {
  const views = useAssignedAppViews();
  const home = pathname === "/";
  const viewId = appViewIdFromPathname(pathname);
  const navigation = desktopNavigation(views, pathname, category);
  const homeTitle = navigation.sections.find(section => section.id === navigation.selectedCategory)?.title ?? "Inicio";
  const title = home ? homeTitle : views.find(view => view.id === viewId)?.name ?? fallbackTitle ?? "Experiencia";
  const inline = width >= 600;
  return <View testID={wide ? "desktop-header" : "compact-header"} style={[s.header, wide && s.headerWide]}>
    <View style={s.row}>
      {!home ? <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={onBack} style={interaction => [s.back, actionSurface(false, interaction, Boolean(false))]}><Text style={s.backText}>←</Text></Pressable> : null}
      <View style={[s.middle, inline && s.middleInline]}>
        <View style={[s.location, inline && { flex: 1 }]}>
          {!wide ? <Text accessibilityLabel={`Contrato: ${contractName ?? "Selecciona un contrato"}`} numberOfLines={2} style={s.contract}>{contractName ?? "Selecciona un contrato"}</Text> : null}
          <Text accessibilityLabel={`Ubicación: ${title}`} numberOfLines={2} style={s.title}>{title}</Text>
        </View>
        <View style={[s.status, inline && s.statusInline]}>{status}</View>
      </View>
      {menu}
    </View>
  </View>;
}

export function createShellHeaderS(p: ThemeColors = colors) {
  return StyleSheet.create({
  header: { backgroundColor: p.canvas, borderBottomColor: p.border, borderBottomWidth: 1, paddingHorizontal: 16, paddingVertical: 8, minWidth: 0 },
  headerWide: { backgroundColor: p.canvas, paddingHorizontal: 24 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 },
  back: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: p.surface },
  backText: { color: p.primary, fontSize: 22 },
  middle: { flex: 1, minWidth: 0, gap: 4 },
  middleInline: { flexDirection: "row", alignItems: "center", gap: 16 },
  location: { flexShrink: 1, minWidth: 0, gap: 2 },
  contract: { color: p.textSecondary, fontSize: 12, lineHeight: 17 },
  title: { color: p.text, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  status: { minWidth: 0, alignItems: "flex-start" },
  statusInline: { flex: 1, alignItems: "flex-end" },
});
}
const s = createShellHeaderS();
