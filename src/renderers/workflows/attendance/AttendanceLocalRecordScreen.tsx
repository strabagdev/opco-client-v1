import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { FormAction, FormActions } from "../../../components/form-actions";
import { ReadFieldList } from "../../../components/read-field-list";
import { ReadLoadingState } from "../../../components/read-loading-indicator";
import { colors } from "../../../theme/paint";
import { useSession } from "../../../state/session";
import { useExperienceActivityReporter } from "../../use-experience-activity";
import { AttendanceRecordRow, copyAttendanceReference } from "./attendance-record-list";
import { AttendanceLocalReadError, inspectAttendanceLocalQueries, readAttendanceLocalRecord,
  type AttendanceLocalReadScope, type AttendanceReadView } from "./attendance-local-read";

type Detail = Awaited<ReturnType<typeof readAttendanceLocalRecord>>;
type Diagnostic = Awaited<ReturnType<typeof inspectAttendanceLocalQueries>>;

/** No write API or sync action is invoked by this screen. Conflict resolution stays in its existing route. */
export function AttendanceLocalRecordScreen({ appView, recordId, requestedDate }: {
  appView: AttendanceReadView; recordId: string; requestedDate?: string;
}) {
  const { definitionCache, ownerKey, selectedContractId, stateUpdateReconnectRefreshKey } = useSession();
  const router = useRouter();
  const [revision, setRevision] = useState(0);
  const scopeKey = JSON.stringify([ownerKey, selectedContractId, appView, recordId, requestedDate, revision, stateUpdateReconnectRefreshKey]);
  const activeScope = useRef(scopeKey);
  useLayoutEffect(() => {
    activeScope.current = scopeKey;
    return () => { activeScope.current = ""; };
  }, [scopeKey]);
  const [state, setState] = useState<{ key: string; detail?: Detail; code?: string; message?: string }>();
  const [inspection, setInspection] = useState<{ key: string; data?: Diagnostic; running?: boolean }>();
  const [feedback, setFeedback] = useState<{ key: string; message: string }>();
  const current = state?.key === scopeKey ? state : undefined;
  const diagnostic = inspection?.key === scopeKey ? inspection : undefined;
  const input: AttendanceLocalReadScope | null = ownerKey && selectedContractId
    ? { ownerKey, contractId: selectedContractId, appView, recordId, requestedDate } : null;
  useEffect(() => {
    let active = true;
    const [ownerKey, contractId, appView, recordId, requestedDate] = JSON.parse(scopeKey);
    if (!ownerKey || !contractId) return;
    void readAttendanceLocalRecord(definitionCache, { ownerKey, contractId, appView, recordId, requestedDate })
      .then(detail => { if (active) setState({ key: scopeKey, detail }); })
      .catch(error => { if (active) setState({ key: scopeKey,
        code: error instanceof AttendanceLocalReadError ? error.code : "LOCAL_RECORD_READ_FAILED",
        message: error instanceof AttendanceLocalReadError ? error.message : "No pudimos leer el cambio local. Se conserva la operación; no se eligió otro registro.",
      }); });
    return () => { active = false; };
  }, [scopeKey, definitionCache]);
  const notice = (!input ? "Selecciona un contrato con acceso a esta experiencia para consultar su copia local." : null) ?? current?.message ?? (feedback?.key === scopeKey ? feedback.message : null) ??
    (current?.detail?.requestedDateMatches === false ? "La fecha del enlace difiere de la fecha guardada. El detalle conserva la fecha original; no se modificó el cambio." : null);
  useExperienceActivityReporter(appView, { activeCount: Number(!!input && !current), readCount: Number(!!input && !current),
    readMode: "initial", errorCode: current?.code ?? null, notice,
    result: !current ? null : current.code ? "error" : "success" });

  async function inspect() {
    if (!input || !current?.detail || diagnostic?.running) return;
    const key = scopeKey;
    setInspection({ key, running: true });
    try {
      const data = await inspectAttendanceLocalQueries(definitionCache, input, current.detail);
      if (activeScope.current === key) setInspection({ key, data });
    } catch {
      if (activeScope.current === key) {
        setInspection({ key });
        setFeedback({ key, message: "No pudimos completar el diagnóstico local. La operación se conserva sin cambios." });
      }
    }
  }
  async function copy() {
    if (!diagnostic?.data) return;
    const key = scopeKey;
    try {
      await copyAttendanceReference(JSON.stringify(diagnostic.data, null, 2));
      setFeedback({ key, message: "Diagnóstico local copiado. Contiene referencias técnicas del cambio; no incluye sesión ni datos de otras personas." });
    } catch { setFeedback({ key, message: "No se pudo copiar. Puedes seleccionar el texto del diagnóstico local." }); }
  }
  return <ScrollView contentContainerStyle={s.content} style={s.screen} testID="attendance-local-read">
    <Text accessibilityRole="header" style={s.title}>{appView.name}</Text>
    <Text style={s.heading}>Detalle del cambio local</Text>
    <Text style={s.meta}>Sólo lectura de este dispositivo. Abrir o consultar este detalle no guarda, reintenta ni sincroniza el cambio.</Text>
    {!current && input ? <ReadLoadingState mode="initial" /> : null}
    {current?.detail ? <AttendanceLocalRecordContent detail={current.detail} /> : null}
    <FormActions>
      <FormAction label="Volver a la experiencia" variant="secondary" onPress={() => router.replace({ pathname: "/view/[appViewId]", params: { appViewId: appView.id } })} />
      <FormAction label="Refrescar lectura local" variant="secondary" disabled={!input || !!input && !current} onPress={() => setRevision(value => value + 1)} />
    </FormActions>
    {current?.detail ? <View style={s.diagnostic}>
      <Text style={s.heading}>Diagnóstico de lectura local</Text>
      <Text style={s.meta}>Compara este registro con las consultas del grupo y del listado reciente. No descarga datos ni corrige la omisión del grupo.</Text>
      <FormActions><FormAction label="Comprobar consultas locales" variant="secondary" busy={diagnostic?.running} disabled={diagnostic?.running} onPress={() => void inspect()} />
        {diagnostic?.data ? <FormAction label="Copiar diagnóstico local" variant="secondary" onPress={() => void copy()} /> : null}</FormActions>
      {diagnostic?.data ? <LocalQueryDiagnostic data={diagnostic.data} /> : null}
    </View> : null}
  </ScrollView>;
}

export function AttendanceLocalRecordContent({ detail }: { detail: Detail }) {
  return <View style={s.detail}>
    <ReadFieldList compact fields={[{ key: "date", label: "Fecha operativa (DATE)", fullWidth: false,
      values: [{ text: detail.scope.date, status: "value" }] }]} />
    <AttendanceRecordRow row={detail.presentation} />
  </View>;
}
function LocalQueryDiagnostic({ data }: { data: Diagnostic }) {
  const [open, setOpen] = useState(false);
  return <View>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} style={s.disclosure}>
      <Text style={s.link}>{open ? "Ocultar diagnóstico técnico" : "Ver diagnóstico técnico"}</Text>
    </Pressable>
    {open ? <Text selectable style={s.technical}>{JSON.stringify(data, null, 2)}</Text> : null}
  </View>;
}
const s = StyleSheet.create({
  screen: { backgroundColor: colors.canvas }, content: { gap: 16, padding: 18, width: "100%", maxWidth: 900, alignSelf: "center" },
  title: { color: colors.text, fontSize: 24, fontWeight: "700" }, heading: { color: colors.text, fontSize: 18, fontWeight: "600" },
  meta: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 }, detail: { gap: 12 },
  diagnostic: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 16, gap: 12 },
  disclosure: { minHeight: 44, justifyContent: "center" }, link: { color: colors.primary, fontSize: 14 },
  technical: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, flexShrink: 1 },
});
