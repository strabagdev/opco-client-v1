import { useEffect, useMemo, useState } from "react";
import type { AttendanceContextField, AttendanceItem, OpcoApi } from "../../../lib/opco-api";
import type { LocalDatabase } from "../../../lib/local-db";
import { relationValueLabels } from "../../../lib/state-update-relations";
import { getRelationTargetEntityTypeId } from "../../../lib/record-form";
import { useExtraRelations } from "../state-update/use-extra-relations";
import { attendanceRelationField } from "./attendance-workflow-logic";

export function useAttendanceContextRelations(input: {
  api: OpcoApi; store: LocalDatabase; token: string | null; ownerKey: string | null; contractId: string | null;
  fields: AttendanceContextField[]; values: Record<string, string | null>; selectedItem: AttendanceItem | null; online: boolean; scope: string;
}) {
  const fieldsKey = JSON.stringify(input.fields.filter(field => field.type === "RELATION"));
  const fields = useMemo(() => (JSON.parse(fieldsKey) as Extract<AttendanceContextField, { type: "RELATION" }>[]).map(attendanceRelationField), [fieldsKey]);
  const catalogs = useExtraRelations({ ...input, fields });
  const selectionKey = JSON.stringify(fields.map(field => [field.id, input.values[field.id] ?? null]));
  const [labels, setLabels] = useState<{ scope: string; selectionKey: string; byField: Record<string, { id: string; displayName: string }[]>; error: string | null }>({ scope: input.scope, selectionKey, byField: {}, error: null });
  const { store, ownerKey, contractId, scope } = input;
  useEffect(() => {
    let active = true;
    if (!ownerKey || !contractId || !fields.length) return;
    const selected = new Map<string, string | null>(JSON.parse(selectionKey));
    void Promise.all(fields.map(async field => {
      const recordId = selected.get(field.id), entityTypeId = getRelationTargetEntityTypeId(field);
      if (!recordId || !entityTypeId) return [field.id, []] as const;
      const record = await store.getCachedRecord({ ownerKey, contractId, entityTypeId, recordId });
      return [field.id, record?.serverId === recordId ? [{ id: recordId, displayName: record.displayName }] : []] as const;
    })).then(entries => { if (active) setLabels({ scope, selectionKey, byField: Object.fromEntries(entries), error: null }); })
      .catch(() => { if (active) setLabels({ scope, selectionKey, byField: {}, error: "No pudimos leer la etiqueta guardada de la selección. Su ID se conserva." }); });
    return () => { active = false; };
  }, [store, ownerKey, contractId, scope, fields, selectionKey]);
  const currentLabels = labels.scope === scope && labels.selectionKey === selectionKey ? labels : null;
  return {
    ...catalogs,
    catalogs: Object.fromEntries(fields.map(field => {
      const catalog = catalogs.catalogs[field.id];
      const current = relationValueLabels(input.selectedItem?.attendance?.contextValues?.[field.id]);
      const options = [...new Map([...(currentLabels?.byField[field.id] ?? []), ...current, ...(catalog?.options ?? [])].map(option => [option.id, option])).values()];
      return [field.id, { ...catalog, options, error: catalog?.error ?? currentLabels?.error ?? null }];
    })),
  };
}
