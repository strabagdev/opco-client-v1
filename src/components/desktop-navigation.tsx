import { Link, useGlobalSearchParams, usePathname, useRouter } from "expo-router";
import { ChevronDown } from "lucide-react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { desktopPalette as p } from "../lib/desktop-presentation";
import { categoryHref, desktopNavigation, scopedDesktopCatalog } from "../lib/desktop-navigation";
import { subscribeLocalDatabaseCacheChanges } from "../lib/local-db";
import type { AppView } from "../lib/opco-api";
import { useSession } from "../state/session";

const Catalog = createContext<(scope: string, views: AppView[]) => void>(() => undefined);
const Views = createContext<AppView[]>([]);
export const usePublishDesktopCatalog = () => useContext(Catalog);

export function DesktopNavigationProvider({ children }: { children: ReactNode }) {
  const { ownerKey, selectedContractId, definitionCache } = useSession();
  const scope = JSON.stringify([ownerKey, selectedContractId]);
  const [catalog, setCatalog] = useState<{ scope: string; views: AppView[] } | null>(null);
  const generation = useRef(0);
  const publish = useCallback((scope: string, views: AppView[]) => { generation.current += 1; setCatalog({ scope, views }); }, []);
  useEffect(() => {
    let active = true, sequence = 0;
    async function read() {
      const request = ++sequence;
      const revision = generation.current;
      if (!ownerKey || !selectedContractId) return;
      try {
        const snapshot = await definitionCache.getAppViews(ownerKey, selectedContractId);
        if (active && request === sequence && revision === generation.current && snapshot) setCatalog({ scope, views: snapshot.views });
      } catch { /* Navigation never substitutes another scope or requests extra remote data. */ }
    }
    void read();
    const unsubscribe = subscribeLocalDatabaseCacheChanges(() => { void read(); });
    return () => { active = false; unsubscribe(); };
  }, [definitionCache, ownerKey, selectedContractId, scope]);
  const views = scopedDesktopCatalog(catalog, ownerKey, selectedContractId);
  return <Catalog.Provider value={publish}><Views.Provider value={views}>{children}</Views.Provider></Catalog.Provider>;
}

export function DesktopSidebar({ width, visible }: { width: number; visible: boolean }) {
  const { context, selectedContractId, setSelectedContractId } = useSession();
  const views = useContext(Views);
  const pathname = usePathname();
  const { category } = useGlobalSearchParams();
  const router = useRouter();
  const navigation = useMemo(() => desktopNavigation(views, pathname, category), [views, pathname, category]);
  const contractScope = JSON.stringify([context?.organization.id, selectedContractId]);
  const [openScope, setOpenScope] = useState<string | null>(null);
  const open = openScope === contractScope;
  const setOpen = (value: boolean | ((current: boolean) => boolean)) => setOpenScope(current =>
    (typeof value === "function" ? value(current === contractScope) : value) ? contractScope : null);
  const summaryRef = useRef<View>(null);
  const selected = context?.contracts.find(contract => contract.id === selectedContractId);
  return <View testID="desktop-sidebar" style={[styles.sidebar, { width, display: visible ? "flex" : "none" }]}>
    <Text style={styles.brand}>Opco</Text>
    <Text style={styles.organization}>{context?.organization.name ?? "-"}</Text>
    <View style={styles.selector} {...(Platform.OS === "web" ? { onKeyDown: (event: { key: string }) => { if (event.key === "Escape") { setOpen(false); (summaryRef.current as unknown as { focus(): void } | null)?.focus(); } } } : {})}>
      <Pressable ref={summaryRef} accessibilityRole="button" accessibilityLabel={`Contrato: ${selected?.name ?? "Selecciona un contrato"}`} accessibilityState={{ expanded: open }}
        onPress={() => setOpen(value => !value)} style={styles.summary}>
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <Text style={styles.caption}>Contrato</Text>
          <Text numberOfLines={2} style={styles.contract}>{selected?.name ?? "Selecciona un contrato"}</Text>
        </View><ChevronDown color={p.primary} size={16} />
      </Pressable>
      {open ? <View testID="desktop-contract-choices" style={styles.choices}>
        <ScrollView style={{ maxHeight: 300 }}>
          {context?.contracts.map(contract => <Pressable key={contract.id} accessibilityRole="button" accessibilityState={{ selected: contract.id === selectedContractId }}
            onPress={() => { setOpen(false); if (contract.id !== selectedContractId) { void setSelectedContractId(contract.id); router.replace("/"); } }}
            style={[styles.choice, contract.id === selectedContractId && { backgroundColor: p.selection }]}>
            <Text style={styles.contract}>{contract.name}</Text>
          </Pressable>)}
        </ScrollView>
      </View> : null}
    </View>
    <ScrollView contentContainerStyle={{ gap: 4 }} style={{ marginTop: 16 }}>
      <Link href="/" asChild><Pressable {...(pathname === "/" && !navigation.active ? { "aria-current": "page" as const } : {})} accessibilityRole="link" accessibilityState={{ selected: pathname === "/" && !navigation.active }}
        style={StyleSheet.flatten([styles.link, pathname === "/" && !navigation.active && styles.active])}><Text style={styles.linkText}>Inicio</Text></Pressable></Link>
      {navigation.sections.map(section => <Link key={section.id} href={categoryHref(section.id)} asChild>
        <Pressable {...(navigation.active === section.id ? { "aria-current": "page" as const } : {})} accessibilityRole="link" accessibilityState={{ selected: navigation.active === section.id }} style={StyleSheet.flatten([styles.link, navigation.active === section.id && styles.active])}>
          <Text style={styles.linkText}>{section.title}</Text>
        </Pressable>
      </Link>)}
    </ScrollView>
    {Platform.OS === "web" ? <style>{`
      [data-testid="desktop-sidebar"] [role="link"]:hover {background:${p.hover}}
      [data-testid="desktop-sidebar"] [role="link"][aria-current="page"] {background:${p.active}}
      [data-testid="desktop-sidebar"] [role="link"]:focus-visible,
      [data-testid="desktop-sidebar"] [role="button"]:focus-visible {outline:3px solid ${p.sidebarFocus};outline-offset:2px}
      [data-testid="desktop-contract-choices"] [role="button"]:focus-visible {outline-color:${p.primary}}
      [data-testid="desktop-sidebar"] [role="button"] {overflow-wrap:anywhere}
      [data-testid="desktop-header"] [role="button"]:focus-visible,
      [data-testid="desktop-home"] [role="link"]:focus-visible,
      [data-testid="desktop-home"] [role="button"]:focus-visible,
      [data-testid="desktop-attendance"] [role="button"]:focus-visible,
      [data-testid="desktop-attendance"] input:focus-visible,
      [data-testid="desktop-attendance"] textarea:focus-visible {outline:3px solid ${p.primary};outline-offset:2px}
      [data-testid="desktop-attendance"] [data-testid="attendance-person-row"]:hover {background:${p.selection}}
    `}</style> : null}
  </View>;
}
const styles = StyleSheet.create({
  sidebar: { backgroundColor: p.sidebar, padding: 20, flexShrink: 0, zIndex: 10 },
  brand: { color: p.surface, fontSize: 26, fontWeight: "800" },
  organization: { color: p.organization, marginTop: 12, fontSize: 13 },
  selector: { marginTop: 18, zIndex: 20 },
  summary: { backgroundColor: p.surface, borderColor: p.controlBorder, borderWidth: 1, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 8, padding: 10, minHeight: 64 },
  caption: { color: p.muted, fontSize: 12, fontWeight: "700" },
  contract: { color: p.text, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  choices: { position: "absolute", top: "100%", left: 0, right: 0, backgroundColor: p.surface, borderWidth: 1, borderColor: p.controlBorder, borderRadius: 8, padding: 4, zIndex: 30 },
  choice: { padding: 10, borderRadius: 6, minHeight: 44 },
  close: { alignSelf: "flex-end", padding: 8 },
  link: { padding: 12, borderLeftWidth: 3, borderLeftColor: "transparent", borderRadius: 6, minHeight: 44 },
  active: { backgroundColor: p.active, borderLeftColor: p.activeMark },
  linkText: { color: p.sidebarText, fontSize: 14, fontWeight: "600" },
});
