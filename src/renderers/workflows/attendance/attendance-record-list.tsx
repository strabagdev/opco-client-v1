import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { FormAction } from "../../../components/form-actions";
import { ReadFieldList } from "../../../components/read-field-list";
import type { AttendanceContextField } from "../../../lib/opco-api";
import { colors as p } from "../../../theme/paint";
import { distinctAttendancePresentations, loadAttendanceRecordPresentation, type AttendancePresentationScope,
  type AttendanceReadRecord, type AttendanceRecordPresentation, type AttendancePresentationStore } from "./attendance-record-presentation";

/** Exact IDs, no shortening or position-derived labels. Selection/copy never constructs a command. */
export async function copyAttendanceReference(id: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(id);
    return;
  }
  if (typeof document === "undefined") throw Error("Selecciona el ID completo para copiarlo.");
  const input = document.createElement("textarea");
  input.value = id; input.readOnly = true; input.style.position = "fixed"; input.style.opacity = "0";
  const focused = document.activeElement;
  document.body.appendChild(input);
  try {
    input.select();
    if (!document.execCommand("copy")) throw Error("Selecciona el ID completo para copiarlo.");
  } finally {
    input.remove();
    if (focused instanceof HTMLElement) focused.focus();
  }
}

export function AttendanceRecordList({ records, fields, statuses = [], scope, store, selectedRecordId, onEdit }: {
  records: AttendanceReadRecord[]; fields: AttendanceContextField[]; statuses?: {optionId: string; label: string}[];
  scope: AttendancePresentationScope | null; store: AttendancePresentationStore;
  selectedRecordId?: string; onEdit?(record: AttendanceReadRecord): void;
}) {
  const key = JSON.stringify([scope, records, fields, statuses]);
  const [state, setState] = useState<{ key: string; rows: AttendanceRecordPresentation[]; error?: string }>();
  useEffect(() => {
    let active = true;
    const [capturedScope, capturedRecords, capturedFields, capturedStatuses] = JSON.parse(key) as [typeof scope, typeof records, typeof fields, typeof statuses];
    if (!capturedScope) return;
    const cacheReads = new Map<string, ReturnType<typeof store.getCachedRecord>>();
    const dailyReads = new Map<string, ReturnType<typeof store.getAttendanceDailyRecords>>();
    const reader: AttendancePresentationStore = {
      getCachedRecord: query => { const key = JSON.stringify(query); if (!cacheReads.has(key)) cacheReads.set(key, store.getCachedRecord(query)); return cacheReads.get(key)!; },
      getAttendanceDailyRecords: query => { const key = JSON.stringify(query); if (!dailyReads.has(key)) dailyReads.set(key, store.getAttendanceDailyRecords(query)); return dailyReads.get(key)!; },
    };
    void Promise.all(capturedRecords.map(record => loadAttendanceRecordPresentation(reader, capturedScope, record, capturedFields, capturedStatuses)))
      .then(rows => { if (active) setState({ key, rows: distinctAttendancePresentations(rows) }); })
      .catch(() => { if (active) setState({ key, rows: [], error: "No pudimos leer las referencias y etiquetas locales. Conserva los datos y vuelve a abrir la experiencia." }); });
    return () => { active = false; };
  }, [key, store]);
  const current = state?.key === key ? state : undefined;
  if (records.length === 0) return null;
  return <View style={s.list}>
    <Text style={s.hint}>Las marcas de tiempo son referencias técnicas, no la hora de la operación ni parte del campo Fecha.</Text>
    {!current ? <Text accessibilityLiveRegion="polite" style={s.hint}>Leyendo referencias de registros…</Text> : null}
    {current?.error ? <Text accessibilityRole="alert" style={s.hint}>{current.error}</Text> : null}
    {current?.rows.map(row => <AttendanceRecordRow key={JSON.stringify([row.referenceKind, row.reference])} row={row}
      selected={Boolean(selectedRecordId && (selectedRecordId === row.record.recordId || selectedRecordId === row.reference || selectedRecordId === row.serverId))}
      onEdit={onEdit ? () => onEdit(row.record) : undefined} />)}
  </View>;
}

export function AttendanceRecordRow({ row, selected = false, onEdit }: {
  row: AttendanceRecordPresentation; selected?: boolean; onEdit?(): void;
}) {
  const [feedback, setFeedback] = useState<string>();
  const copy = async (id: string) => {
    try { await copyAttendanceReference(id); setFeedback("ID completo copiado."); }
    catch { setFeedback("No se pudo copiar automáticamente. Selecciona el ID completo para copiarlo."); }
  };
  return <View style={[s.row, selected && s.selected]} testID="attendance-record-row">
    <View style={s.heading}>
      <View style={s.subject}>
        <Text style={s.title}>{row.record.person.displayName}</Text>
        {selected ? <Text style={s.selectedLabel}>Editando este registro</Text> : null}
        {row.syncLabel ? <Text style={s.hint}>{row.syncLabel}</Text> : null}
      </View>
      {onEdit ? <FormAction label="Editar" accessibilityLabel={`Editar registro ${row.reference}`} onPress={onEdit} /> : null}
    </View>
    <ReadFieldList compact fields={row.fields} />
    <View style={s.identification}>
    <Text style={s.label}>{row.referenceKind === "local" ? "Referencia local fija" : row.referenceKind === "server" ? "Referencia del servidor" : "Referencia del registro"}</Text>
    <Text selectable style={s.reference} accessibilityLabel={`Referencia completa: ${row.reference}`}>{row.reference}</Text>
    <View style={s.actions}>
      <FormAction variant="secondary" label="Copiar referencia" accessibilityLabel={`Copiar referencia completa ${row.reference}`} onPress={() => void copy(row.reference)} />
    </View>
    {row.serverId && row.serverId !== row.reference ? <View style={s.server}>
      <Text style={s.label}>ID completo en servidor</Text><Text selectable style={s.reference}>{row.serverId}</Text>
      <FormAction variant="secondary" label="Copiar ID servidor" accessibilityLabel={`Copiar ID servidor ${row.serverId}`} onPress={() => void copy(row.serverId!)} />
    </View> : null}
    {feedback ? <Text accessibilityLiveRegion="polite" style={s.hint}>{feedback}</Text> : null}
    <View style={s.times}>
      {row.timestamps.length ? row.timestamps.map(t => <View key={t.label} style={s.time}><Text style={s.label}>{t.label}</Text><Text selectable style={s.timeText}>{t.text}</Text></View>)
        : <Text style={s.hint}>Sin marca temporal acreditada.</Text>}
    </View>
    </View>
  </View>;
}

const s = StyleSheet.create({
  list: { gap: 12, minWidth: 0 },
  row: { gap: 8, paddingVertical: 14, borderBottomWidth: 1, borderColor: p.border, minWidth: 0 },
  selected: { borderLeftWidth: 3, borderLeftColor: p.primary, paddingLeft: 12 },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: 12, minWidth: 0 },
  subject: { flex: 1, gap: 4, minWidth: 0 },
  identification: { gap: 6, borderTopWidth: 1, borderTopColor: p.border, paddingTop: 8, minWidth: 0 },
  selectedLabel: { color: p.primary, fontSize: 14, fontWeight: "700" },
  title: { color: p.text, fontSize: 16, fontWeight: "700" },
  label: { color: p.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: "700" },
  reference: { color: p.textSecondary, fontSize: 12, lineHeight: 18, flexShrink: 1, minWidth: 0 },
  hint: { color: p.textSecondary, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, minWidth: 0 },
  server: { alignItems: "flex-start", gap: 4, minWidth: 0 },
  times: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  time: { flexBasis: 220, flexGrow: 1, gap: 2, minWidth: 0 },
  timeText: { color: p.textSecondary, fontSize: 12, lineHeight: 18 },
});
