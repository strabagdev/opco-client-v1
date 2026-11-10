import { ThemeSelection } from "../theme/theme-selection";
import { type ThemeColors } from "../theme/tokens";
import { colors } from "../theme/paint";
import { Link, useGlobalSearchParams, usePathname, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CompactSelect } from "./compact-select";
import { useAssignedAppViews } from "./desktop-navigation";
import { categoryHref, desktopNavigation } from "../lib/desktop-navigation";
import { useSession } from "../state/session";

/** Reuses the assigned navigation catalog and existing contract/session handler. No data fetching. */
export function AppNavigationMenu({ onNavigate, showNavigation }: { onNavigate(): void; showNavigation: boolean }) {
  const { context, selectedContractId, setSelectedContractId } = useSession();
  const views = useAssignedAppViews();
  const pathname = usePathname();
  const { category } = useGlobalSearchParams();
  const router = useRouter();
  const navigation = desktopNavigation(views, pathname, category);
  return <View style={s.content}>
    {showNavigation ? <View style={s.group}>
      <Text accessibilityRole="header" style={s.label}>Navegación</Text>
      <Link href="/" asChild><Pressable accessibilityRole="link" onPress={onNavigate}
        style={StyleSheet.flatten([s.link, pathname === "/" && !navigation.active && s.active])}><Text style={s.linkText}>Inicio · Todas las experiencias</Text></Pressable></Link>
      {navigation.sections.map(section => <Link key={section.id} href={categoryHref(section.id)} asChild>
        <Pressable accessibilityRole="link" onPress={onNavigate} accessibilityState={{ selected: navigation.active === section.id }}
          style={StyleSheet.flatten([s.link, navigation.active === section.id && s.active])}><Text style={s.linkText}>{section.title}</Text></Pressable>
      </Link>)}
    </View> : null}
    <View style={s.group}>
      <Text accessibilityRole="header" style={s.label}>Contexto de trabajo</Text>
      <Text style={s.text}>{context?.organization.name ?? "Organización no disponible"}</Text>
      {context?.contracts.length ? <CompactSelect label="Contrato activo" required value={selectedContractId ?? ""}
        options={context.contracts.map(contract => ({ value: contract.id, label: `${contract.name} · ${contract.role}` }))}
        onChange={value => {
          onNavigate();
          if (String(value) !== selectedContractId) { void setSelectedContractId(String(value)); router.replace("/"); }
        }} /> : <Text style={s.text}>No hay contratos disponibles.</Text>}
    </View>
    <ThemeSelection />
  </View>;
}

export function createNavigationMenuS(p: ThemeColors = colors) {
  return StyleSheet.create({
  content: { gap: 20 }, group: { gap: 8, minWidth: 0 },
  label: { color: p.textSecondary, fontSize: 13, fontWeight: "700" },
  text: { color: p.text, fontSize: 15, lineHeight: 21 },
  link: { paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8, minHeight: 44, justifyContent: "center" },
  active: { backgroundColor: p.selection }, linkText: { color: p.primary, fontSize: 16, fontWeight: "600" },
});
}
const s = createNavigationMenuS();
