import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  BROWSER_PERSISTENCE_LABELS, formatEstimatedStorageBytes, readBrowserStorageDiagnostics,
  requestBrowserStoragePersistence, UNKNOWN_BROWSER_STORAGE,
} from "../lib/browser-storage-diagnostics";
import { colors } from "../theme/paint";
import { space, typography } from "../theme/tokens";
import { FormAction, FormActions } from "./form-actions";

/** Mounted only in the existing PWA diagnostic. Never requests permissions on mount or refresh. */
export function BrowserStorageDiagnostics() {
  const [snapshot, setSnapshot] = useState(UNKNOWN_BROWSER_STORAGE);
  const [busy, setBusy] = useState(true);
  const [requested, setRequested] = useState(false);
  const active = useRef(false), working = useRef(false), attempted = useRef(false);
  const sequence = useRef(0);
  useEffect(() => {
    const current = ++sequence.current;
    active.current = true;
    working.current = true;
    void readBrowserStorageDiagnostics().then(value => {
      if (current !== sequence.current) return;
      if (active.current) { setSnapshot(value); setBusy(false); }
      working.current = false;
    });
    return () => { active.current = false; sequence.current += 1; };
  }, []);

  async function refresh() {
    if (working.current) return;
    working.current = true;
    const current = ++sequence.current;
    setBusy(true);
    const value = await readBrowserStorageDiagnostics();
    if (current !== sequence.current) return;
    working.current = false;
    if (active.current) { setSnapshot(value); setBusy(false); }
  }
  async function request() {
    if (working.current || attempted.current || !snapshot.canRequest || snapshot.persistence === "granted") return;
    working.current = true;
    const current = ++sequence.current;
    attempted.current = true;
    setRequested(true);
    setBusy(true);
    const value = await requestBrowserStoragePersistence();
    if (current !== sequence.current) return;
    working.current = false;
    if (active.current) { setSnapshot(value); setBusy(false); }
  }
  const rows = [
    ["Persistencia del navegador", BROWSER_PERSISTENCE_LABELS[snapshot.persistence]],
    ["Uso estimado", formatEstimatedStorageBytes(snapshot.usage)],
    ["Cuota estimada", formatEstimatedStorageBytes(snapshot.quota)],
  ];
  return <View style={styles.section}>
    <Text style={styles.title}>Protección del almacenamiento</Text>
    {rows.map(([label, value]) => <View key={label}>
      <Text style={styles.label}>{label}</Text><Text selectable style={styles.value}>{value}</Text>
    </View>)}
    <Text style={styles.notice}>La cuota es una estimación, no espacio garantizado. La persistencia no es un respaldo y no protege frente al borrado explícito.</Text>
    {snapshot.requestFailed ? <Text style={styles.notice}>No se pudo completar la solicitud. Puedes continuar trabajando; la protección no está confirmada.</Text>
      : snapshot.queryFailed || snapshot.estimateFailed ? <Text style={styles.notice}>No se pudo consultar toda la información del navegador.</Text> : null}
    <FormActions>
      <FormAction label="Actualizar almacenamiento" variant="secondary" disabled={busy} onPress={() => { void refresh(); }} />
      <FormAction label={requested ? "Solicitud realizada" : "Solicitar persistencia"}
        disabled={busy || requested || !snapshot.canRequest || snapshot.persistence === "granted"}
        onPress={() => { void request(); }} />
    </FormActions>
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: space.sm },
  title: { ...typography.section, color: colors.text },
  label: { ...typography.label, color: colors.textSecondary },
  value: { ...typography.body, color: colors.text },
  notice: { ...typography.meta, color: colors.textSecondary },
});
