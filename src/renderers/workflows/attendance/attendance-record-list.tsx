import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FormAction } from "../../../components/form-actions";
import { SubjectIdentity } from "../../../components/subject-identity";
import type { SubjectPresentationDefinition } from "../../../lib/subject-presentation";
import { actionSurface } from "../../../theme/operational-presentation";
import { ReadFieldList } from "../../../components/read-field-list";
import type { AttendanceContextField } from "../../../lib/opco-api";
import { colors as p } from "../../../theme/paint";
import { distinctAttendancePresentations, groupAttendancePresentations, loadAttendanceRecordPresentation, readAttendancePresentedSubject, type AttendancePresentationScope,
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

export type AttendanceGroupRead = { records: AttendanceReadRecord[]; complete: boolean };
export function AttendanceRecordList({ records, fields, statuses = [], scope, store, selectedRecordId, onEdit,
  grouped = false, totalCount, onLoadGroup, subjectConfig, subjectDefinition }: {
  records: AttendanceReadRecord[]; fields: AttendanceContextField[]; statuses?: {optionId: string; label: string}[];
  scope: AttendancePresentationScope | null; store: AttendancePresentationStore;
  selectedRecordId?: string; onEdit?(record: AttendanceReadRecord): void;
  grouped?: boolean; totalCount?: number;
  onLoadGroup?(subjectId: string): Promise<AttendanceGroupRead>;
  subjectConfig?: unknown; subjectDefinition?: SubjectPresentationDefinition;
}) {
  const key = JSON.stringify([scope, records, fields, statuses, subjectConfig, subjectDefinition]);
  const [state, setState] = useState<{ key: string; rows: AttendanceRecordPresentation[]; error?: string }>();
  useEffect(() => {
    let active = true;
    const [capturedScope, capturedRecords, capturedFields, capturedStatuses, capturedConfig, capturedDefinition] = JSON.parse(key) as [typeof scope, typeof records, typeof fields, typeof statuses, typeof subjectConfig, typeof subjectDefinition];
    if (!capturedScope) return;
    const cacheReads = new Map<string, ReturnType<typeof store.getCachedRecord>>();
    const dailyReads = new Map<string, ReturnType<typeof store.getAttendanceDailyRecords>>();
    const reader: AttendancePresentationStore = {
      getCachedRecord: query => { const key = JSON.stringify(query); if (!cacheReads.has(key)) cacheReads.set(key, store.getCachedRecord(query)); return cacheReads.get(key)!; },
      getAttendanceDailyRecords: query => { const key = JSON.stringify(query); if (!dailyReads.has(key)) dailyReads.set(key, store.getAttendanceDailyRecords(query)); return dailyReads.get(key)!; },
    };
    void Promise.all(capturedRecords.map(async record => loadAttendanceRecordPresentation(reader, capturedScope,
      {...record, person: await readAttendancePresentedSubject(reader, capturedScope, record.person, capturedConfig ?? undefined, capturedDefinition)}, capturedFields, capturedStatuses)))
      .then(rows => { if (active) setState({ key, rows: distinctAttendancePresentations(rows) }); })
      .catch(() => { if (active) setState({ key, rows: [], error: "No pudimos leer las referencias y etiquetas locales. Conserva los datos y vuelve a abrir la experiencia." }); });
    return () => { active = false; };
  }, [key, store]);
  const current = state?.key === key ? state : undefined;
  if (records.length === 0) return null;
  const rowProps = (row: AttendanceRecordPresentation) => ({ row,
    selected: Boolean(selectedRecordId && [row.record.recordId, row.reference, row.serverId].includes(selectedRecordId)),
    onEdit: onEdit ? () => onEdit(row.record) : undefined });
  return <View style={s.list}>
    {!current ? <Text accessibilityLiveRegion="polite" style={s.hint}>Leyendo registros…</Text> : null}
    {current?.error ? <Text accessibilityRole="alert" style={s.hint}>{current.error}</Text> : null}
    {grouped ? groupAttendancePresentations(current?.rows ?? []).map(group => <AttendanceRecordGroup
      key={JSON.stringify([scope, group.subject.id])} group={group} complete={current?.rows.length === totalCount}
      fields={fields} statuses={statuses} scope={scope} store={store} rowProps={rowProps}
      onLoad={onLoadGroup} subjectConfig={subjectConfig} subjectDefinition={subjectDefinition} />)
      : current?.rows.map(row => <AttendanceRecordRow key={JSON.stringify([row.referenceKind, row.reference])} {...rowProps(row)} />)}
  </View>;
}

function AttendanceRecordGroup({ group, complete, fields, statuses, scope, store, rowProps, onLoad, subjectConfig, subjectDefinition }: {
  group: ReturnType<typeof groupAttendancePresentations>[number]; complete: boolean;
  fields: AttendanceContextField[]; statuses: {optionId: string; label: string}[];
  scope: AttendancePresentationScope | null; store: AttendancePresentationStore;
  rowProps(row: AttendanceRecordPresentation): Parameters<typeof AttendanceRecordRow>[0];
  onLoad?(subjectId: string): Promise<AttendanceGroupRead>;
  subjectConfig?: unknown; subjectDefinition?: SubjectPresentationDefinition;
}) {
  const [expanded, setExpanded] = useState(false);
  const dataKey = JSON.stringify(group.rows);
  const generation = useRef(0);
  const [read, setRead] = useState<{key: string; rows?: AttendanceRecordPresentation[]; complete?: boolean; loading?: boolean; error?: string}>();
  useEffect(() => () => { generation.current += 1; }, [dataKey]);
  const current = read?.key === dataKey ? read : undefined;
  const rows = current?.rows ?? group.rows;
  const exact = current?.complete ?? complete;
  async function toggle() {
    setExpanded(!expanded);
    if (expanded || !onLoad || !scope || current?.loading) return;
    const request = ++generation.current;
    setRead({key: dataKey, loading: true});
    try {
      const result = await onLoad(group.subject.id);
      if (request !== generation.current) return;
      const loaded = await Promise.all(result.records.map(record => loadAttendanceRecordPresentation(store, scope, record, fields, statuses)));
      if (request === generation.current) setRead({key: dataKey,
        rows: distinctAttendancePresentations(result.complete ? loaded : [...group.rows, ...loaded]), complete: result.complete});
    } catch (error) {
      if (request === generation.current) setRead({key: dataKey, error: error instanceof Error ? error.message : "No pudimos actualizar el detalle. Se conservan los registros disponibles."});
    }
  }
  return <View style={s.group} testID="attendance-record-group">
    <View style={s.heading}>
      <View style={s.subject}><SubjectIdentity subject={group.subject} config={subjectConfig} definition={subjectDefinition} titleStyle={s.title} />
        <Text style={s.hint}>{rows.length} {rows.length === 1 ? "registro" : "registros"}{exact ? "" : " disponibles"}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{expanded, busy: current?.loading}}
        accessibilityLabel={`${expanded ? "Ocultar" : "Ver"} detalle de ${group.subject.displayName}`}
        onPress={() => void toggle()} style={interaction => [s.disclosure, actionSurface(false, interaction, false)]}>
        <Text style={s.link}>{expanded ? "Ocultar detalle" : "Ver detalle"}</Text>
      </Pressable>
    </View>
    {expanded ? <View style={s.list}>
      {current?.loading ? <Text accessibilityLiveRegion="polite" style={s.hint}>Actualizando detalle…</Text> : null}
      {current?.error ? <Text accessibilityRole="alert" style={s.hint}>{current.error}</Text> : null}
      {!exact ? <Text style={s.hint}>Se muestran los registros disponibles en esta lectura; la cobertura del día puede ser parcial.</Text> : null}
      <Text style={s.hint}>Las marcas de tiempo son referencias; no forman parte del campo Fecha.</Text>
      {rows.map(row => <AttendanceRecordRow key={JSON.stringify([row.referenceKind, row.reference])} {...rowProps(row)} compact />)}
    </View> : null}
  </View>;
}

export function AttendanceRecordRow({ row, selected = false, onEdit, compact = false }: {
  row: AttendanceRecordPresentation; selected?: boolean; onEdit?(): void; compact?: boolean;
}) {
  const [feedback, setFeedback] = useState<string>();
  const [technical, setTechnical] = useState(false);
  const copy = async (id: string) => {
    try { await copyAttendanceReference(id); setFeedback("ID completo copiado."); }
    catch { setFeedback("No se pudo copiar automáticamente. Selecciona el ID completo para copiarlo."); }
  };
  return <View style={[s.row, selected && s.selected]} testID="attendance-record-row">
    <View style={s.heading}>
      <View style={s.subject}>
        <Text style={s.title}>{compact ? `${row.fields[0].label}: ${row.fields[0].values.map(v => v.text).join(", ")}` : row.record.person.displayName}</Text>
        {selected ? <Text style={s.selectedLabel}>Editando este registro</Text> : null}
        {row.syncLabel ? <Text style={s.hint}>{row.syncLabel}</Text> : null}
      </View>
      {onEdit ? <FormAction label="Editar" accessibilityLabel={`Editar registro ${row.reference}`} onPress={onEdit} /> : null}
    </View>
    <ReadFieldList compact fields={compact ? row.fields.slice(1) : row.fields} />
    <View style={s.times}>
      {row.timestamps.map(t => <View key={t.label} style={s.time}><Text style={s.label}>{t.label}</Text><Text selectable style={s.timeText}>{t.text}</Text></View>)}
    </View>
    <Pressable accessibilityRole="button" accessibilityState={{expanded: technical}}
      accessibilityLabel={`Detalle técnico de registro ${row.reference}`} onPress={() => setTechnical(!technical)}
      style={interaction => [s.technicalToggle, actionSurface(false, interaction, false)]}>
      <Text style={s.hint}>{technical ? "Ocultar detalle técnico" : "Detalle técnico"}</Text>
    </Pressable>
    {technical ? <View style={s.identification}>
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
    </View> : null}
  </View>;
}

const s = StyleSheet.create({
  list: { gap: 8, minWidth: 0 },
  group: { gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderColor: p.border, minWidth: 0 },
  disclosure: { minHeight: 44, minWidth: 112, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: p.controlBorder, borderRadius: 8, justifyContent: "center" },
  link: { color: p.primary, fontSize: 14, fontWeight: "600" },
  technicalToggle: { minHeight: 44, alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 8, justifyContent: "center", borderRadius: 8 },
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
