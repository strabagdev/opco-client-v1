import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import type { StateUpdateOfflineStore, StateUpdateScope } from "@/lib/state-update-offline";

type CancellationStore = Pick<StateUpdateOfflineStore, "getStateUpdateLocalCancellation" | "cancelNeverDispatchedStateUpdate">;
export function LocalReportCancellation({ store, scope, localRecordId, subjectRecordId, observedUpdatedAt, onCancelled }: {
  store: CancellationStore; scope: StateUpdateScope; localRecordId: string; subjectRecordId: string; observedUpdatedAt?: string; onCancelled(): void;
}) {
  const key = JSON.stringify([scope, localRecordId, subjectRecordId, observedUpdatedAt]);
  const [proof, setProof] = useState<{ key: string; clientRequestId: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null), [error, setError] = useState<{key:string;message:string} | null>(null), [busy, setBusy] = useState<string | null>(null);
  const currentKey = useRef<string | null>(key);
  useLayoutEffect(() => { currentKey.current = key; return () => { currentKey.current = null; }; }, [key]);
  useEffect(() => {
    const [selectedScope, selectedRecord, selectedSubject] = JSON.parse(key);
    let current = true;
    if (store.getStateUpdateLocalCancellation) void store.getStateUpdateLocalCancellation({ ...selectedScope, localRecordId: selectedRecord, subjectRecordId: selectedSubject })
      .then(result => { if (current) setProof(result ? { key, ...result } : null); }).catch(() => { if (current) setProof(null); });
    return () => { current = false; };
  }, [store, key]); // key contains the complete scope and selected intention slot.
  if (proof?.key !== key) return null;
  async function remove() {
    if (!proof || !store.cancelNeverDispatchedStateUpdate) return;
    setBusy(key);
    try { await store.cancelNeverDispatchedStateUpdate({ ...scope, localRecordId, subjectRecordId, clientRequestId: proof.clientRequestId }); if (currentKey.current === key) { setConfirm(null); onCancelled(); } }
    catch { if (currentKey.current === key) setError({key, message:"No se eliminó el reporte: cambió o pudo haberse enviado. Revisa su estado antes de continuar."}); }
    finally { if (currentKey.current === key) setBusy(null); }
  }
  return <>
    <Pressable accessibilityRole="button" onPress={() => setConfirm(key)}><Text style={{ color: "#b42318", padding: 12 }}>Eliminar alta sólo local</Text></Pressable>
    <Modal visible={confirm === key} transparent onRequestClose={() => busy !== key && setConfirm(null)}>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0008", padding: 20 }}>
        <View style={{ backgroundColor: "white", padding: 24, gap: 16, maxWidth: 480 }}>
          <Text>¿Eliminar este reporte que nunca se ha enviado? Se elimina únicamente esta alta local. No se modifica Opco.</Text>
          {error?.key === key ? <Text accessibilityRole="alert">{error.message}</Text> : null}
          <Pressable accessibilityRole="button" disabled={busy === key} onPress={() => setConfirm(null)}><Text style={{ padding: 12 }}>Cancelar</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={busy === key} onPress={() => void remove()}><Text style={{ padding: 12, color: "#b42318" }}>Eliminar alta local</Text></Pressable>
        </View>
      </View>
    </Modal>
  </>;
}
