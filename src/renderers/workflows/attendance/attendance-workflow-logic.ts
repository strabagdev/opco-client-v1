import { readAttendanceContextValue } from "../../../lib/attendance-context-values";
import {workflowWriteMetadata} from "../../../lib/workflow-write-contract";
import { getRelationTargetEntityTypeId, isRelationFieldMultiple } from "../../../lib/record-form";
import {
  AttendanceBatchEntry,
  AttendanceBatchResult,
  AttendanceContextField,
  AttendanceContextValues,
  AttendanceLatestItem,
  AttendanceResponse,
  AttendanceStatusOption,
  AttendanceWorkflowConfig,
  EntityField,
  EntityRecordValue,
  StateUpdateItem,
} from "@/lib/opco-api";

export const ATTENDANCE_SEARCH_DEBOUNCE_MS = 300;
// Mirrors the backend Attendance latest take=10 contract used to infer full-day snapshots.
export const ATTENDANCE_LATEST_LIMIT = 10;

export type AttendanceDayScope = {
  appViewId: string;
  contractId: string;
  date: string;
  ownerKey: string;
  targetEntityTypeId: string;
};

export type AttendanceDayReadResult = "absent" | "failed" | "prepared-local" | "remote";

export function formatLocalDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function shiftLocalDate(value: string, amount: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  date.setDate(date.getDate() + amount);

  return formatLocalDateInput(date);
}

export function constrainAttendanceDate(value: string | undefined, today: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return today;
  const [year, month, day] = value.split("-").map(Number);
  if (formatLocalDateInput(new Date(year, month - 1, day)) !== value) return today;
  return value > today ? today : value;
}

export function attendanceOfflineDayNotice(snapshotHydrated: boolean, localEventCount: number) {
  if (snapshotHydrated) return null;
  return localEventCount > 0
    ? "Hay registros locales de este dia, pero su cobertura completa aun no esta verificada. El total no esta disponible sin conexion."
    : "Datos de este dia aun no disponibles sin conexion.";
}

export function attendanceConfigurationKey(config: AttendanceWorkflowConfig) {
  return JSON.stringify([config.sourceEntityTypeId, config.targetEntityTypeId, config.personFieldId,
    config.dateFieldId, config.statusFieldId, config.observationFieldId ?? null,
    config.defaultCheckInOptionId, config.contextFieldIds ?? []]);
}

export function isAttendanceDayScopeCurrent(currentScope: AttendanceDayScope | null, requestedScope: AttendanceDayScope) {
  return currentScope?.ownerKey === requestedScope.ownerKey &&
    currentScope.contractId === requestedScope.contractId &&
    currentScope.appViewId === requestedScope.appViewId &&
    currentScope.targetEntityTypeId === requestedScope.targetEntityTypeId &&
    currentScope.date === requestedScope.date;
}

export function formatDisplayDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

export function normalizeAttendanceSearch(value: string) {
  return value.trim();
}

export function shouldSearchAttendancePeople(value: string) {
  return normalizeAttendanceSearch(value).length > 0;
}

export function formatAttendancePendingText(pendingCount: number) {
  if (pendingCount <= 0) {
    return null;
  }

  return pendingCount === 1
    ? "1 registro por sincronizar"
    : `${pendingCount} registros por sincronizar`;
}

export function shouldFinishAttendanceVisualRequest({
  activeRequestId,
  requestId,
}: {
  activeRequestId: number | null;
  requestId: number;
}) {
  return activeRequestId === requestId;
}

export function isAttendanceRequestCurrent(currentRequestId: number, requestId: number) {
  return currentRequestId === requestId;
}

export function shouldPublishAttendanceDay({
  currentRequestId,
  currentScope,
  readResult,
  requestId,
  requestedScope,
}: {
  currentRequestId: number;
  currentScope: AttendanceDayScope | null;
  readResult: AttendanceDayReadResult;
  requestId: number;
  requestedScope: AttendanceDayScope;
}) {
  return currentRequestId === requestId &&
    readResult !== "absent" &&
    readResult !== "failed" &&
    isAttendanceDayScopeCurrent(currentScope, requestedScope);
}

export function shouldRefreshAttendanceLatestAfterSync(
  lastSync: { completedAt?: string | null; result?: string | null } | null | undefined,
) {
  return Boolean(
    lastSync?.completedAt &&
    (lastSync.result === "success" || lastSync.result === "reconciled_success"),
  );
}

export function shouldRenderAttendanceInlineFeedback(phase: string) {
  return phase === "FAILED" ||
    phase === "UNRESOLVED_ERROR" ||
    phase === "CONFLICT" ||
    phase === "SUCCESS";
}

export function shouldShowAttendanceStatusActions({
  hasSelectedItem,
  statusesCount,
}: {
  hasSelectedItem: boolean;
  statusesCount: number;
}) {
  return hasSelectedItem && statusesCount > 0;
}

export function shouldShowAttendanceSubtitle({
  subtitle,
  title,
}: {
  subtitle: string;
  title: string;
}) {
  return subtitle.trim().toLocaleLowerCase() !== title.trim().toLocaleLowerCase();
}

export function selectDefaultCheckInStatus(statuses: AttendanceStatusOption[]) {
  return statuses.find((status) => status.isDefaultCheckIn) ?? statuses[0] ?? null;
}

export function splitStatusButtons(statuses: AttendanceStatusOption[]) {
  const defaultStatus = selectDefaultCheckInStatus(statuses);

  return {
    defaultStatus,
    otherStatuses: defaultStatus
      ? statuses.filter((status) => status.optionId !== defaultStatus.optionId)
      : statuses,
  };
}

export function mergeAttendanceStatuses(current: AttendanceStatusOption[], next: AttendanceStatusOption[]) {
  return next.length > 0 ? next : current;
}

export function firstBlockingAttendanceResult(results: AttendanceBatchResult[]) {
  return results.find((result) => result.result === "CONFLICT" || result.result === "ERROR") ?? null;
}

export function hasSuccessfulAttendanceResult(results: AttendanceBatchResult[]) {
  return results.some((result) => (
    result.result === "CREATED" ||
    result.result === "UNCHANGED" ||
    result.result === "UPDATED"
  ));
}

export function isAttendanceRemoteSnapshotComplete(response: Pick<AttendanceResponse, "latest" | "summary">, latestLimit = ATTENDANCE_LATEST_LIMIT) {
  return response.summary.totalRegistered <= latestLimit && response.latest.length === response.summary.totalRegistered;
}

export function mergeAttendanceLatestWithLocalOverlay(
  remoteLatest: AttendanceLatestItem[],
  localLatest: AttendanceLatestItem[],
) {
  const visibleBySubject = new Map<string, AttendanceLatestItem>();

  for (const item of remoteLatest) {
    visibleBySubject.set(attendanceLatestDedupeKey(item), item);
  }

  for (const item of localLatest) {
    visibleBySubject.set(attendanceLatestDedupeKey(item), item);
  }

  return [...visibleBySubject.values()];
}

export function attendanceResponseToStateUpdateItems(
  response: AttendanceResponse,
  config: {
    contextFieldIds?: string[];
    observationFieldId?: string;
    statusFieldId: string;
  },
): StateUpdateItem[] {
  const items = new Map<string, StateUpdateItem>();

  for (const item of response.items) {
    items.set(item.person.id, {
      current: item.attendance
        ? {
            extraValues: attendanceCurrentExtraValues(
              item.attendance.contextValues,
              response.contextFields ?? [],
              config.observationFieldId,
              item.attendance.observation,
            ),
            recordId: item.attendance.recordId,
            stateValues: [{
              fieldId: config.statusFieldId,
              label: item.attendance.statusLabel,
              optionId: item.attendance.statusOptionId,
            }],
            updatedAt: item.attendance.updatedAt,
          }
        : null,
      subject: item.person,
    });
  }

  for (const item of response.latest) {
    items.set(item.person.id, {
      current: {
        extraValues: attendanceLatestExtraValues(item.contextValues, response.contextFields ?? []),
        recordId: item.attendanceRecordId,
        stateValues: [{
          fieldId: config.statusFieldId,
          label: item.statusLabel,
          optionId: item.statusOptionId,
        }],
        updatedAt: item.updatedAt,
      },
      subject: item.person,
    });
  }

  return [...items.values()];
}

function attendanceLatestExtraValues(contextValues: AttendanceContextValues | undefined, fields: AttendanceContextField[]) {
  if (!contextValues) {
    return undefined;
  }

  const extraValues = Object.fromEntries(Object.entries(contextValues).map(([fieldId, value]) => [
    fieldId,
    contextValueToCanonicalValue(fieldId, value, fields),
  ]));

  return Object.keys(extraValues).length > 0 ? extraValues : undefined;
}

export function attendanceRelationField(field: Extract<AttendanceContextField, { type: "RELATION" }>): EntityField {
  return { ...field, key: field.key ?? field.id };
}

export function sanitizeAttendanceContextSelections(
  fields: AttendanceContextField[],
  values: Record<string, string | null | undefined>,
) {
  return Object.fromEntries(fields.map((field) => {
    const optionId = values[field.id];
    if (field.type === "RELATION") return [field.id, typeof optionId === "string" && optionId ? optionId : null];
    const option = optionId
      ? field.options.find((item) => item.optionId === optionId)
      : null;

    return [field.id, option ? option.optionId : null];
  }));
}

export function attendanceContextValidationErrors(
  fields: AttendanceContextField[],
  values: Record<string, string | null | undefined>,
) {
  const errors: { fieldId: string; message: string }[] = [];

  for (const field of fields) {
    const optionId = values[field.id] ?? null;

    if (field.required && !optionId) {
      errors.push({ fieldId: field.id, message: `${field.name} es obligatorio.` });
      continue;
    }

    if (!optionId) {
      continue;
    }

    if (field.type === "RELATION") {
      if (!getRelationTargetEntityTypeId(attendanceRelationField(field)) || isRelationFieldMultiple(attendanceRelationField(field))) errors.push({ fieldId: field.id, message: `${field.name} no tiene un catálogo simple disponible. Actualiza la definición con conexión.` });
      continue;
    }
    const option = field.options.find((item) => item.optionId === optionId || item.value === optionId);

    if (!option?.value) {
      errors.push({ fieldId: field.id, message: `${field.name} no tiene una opcion valida.` });
    }
  }

  return errors;
}

export function attendanceContextExtraValues(
  fields: AttendanceContextField[],
  values: Record<string, string | null | undefined>,
) {
  return Object.fromEntries(fields
    .map((field) => {
      const optionId = values[field.id] ?? null;
      if (field.type === "RELATION") return [field.id, canonicalAttendanceContextValue(field, optionId)] as const;
      const option = optionId ? field.options.find(item => item.optionId === optionId || item.value === optionId) : null;
      return [field.id, option?.value ?? null] as const;
    })
    .filter(([, value]) => value !== null));
}

export function attendanceEntryToStateUpdateEntry(
  entry: AttendanceBatchEntry,
  config: AttendanceWorkflowConfig,
  contextFields: AttendanceContextField[],
) {
  return {
    ...workflowWriteMetadata(entry),
    expectedUpdatedAt: entry.expectedUpdatedAt,
    extraValues: attendanceEntryExtraValues(entry, config, contextFields),
    overwrite: entry.overwrite,
    stateValues: [{ fieldId: config.statusFieldId, optionId: entry.statusOptionId }],
    subjectRecordId: entry.personRecordId,
  };
}

export function attendanceEntryExtraValues(
  entry: AttendanceBatchEntry,
  config: AttendanceWorkflowConfig,
  contextFields: AttendanceContextField[],
) {
  const extraValues: Record<string, string | null> = {};
  const fieldsById = new Map(contextFields.map((field) => [field.id, field]));

  for (const [fieldId, optionId] of Object.entries(entry.contextValues ?? {})) {
    if ((config.contextFieldIds ?? []).includes(fieldId)) {
      extraValues[fieldId] = canonicalAttendanceContextValue(fieldsById.get(fieldId), optionId);
    }
  }

  if (config.observationFieldId && entry.observation !== undefined) {
    extraValues[config.observationFieldId] = entry.observation;
  }

  return Object.keys(extraValues).length > 0 ? extraValues : undefined;
}

function attendanceCurrentExtraValues(
  contextValues: AttendanceContextValues | undefined,
  fields: AttendanceContextField[],
  observationFieldId: string | undefined,
  observation: string | null,
) {
  const extraValues: Record<string, EntityRecordValue> = {};

  if (contextValues) {
    for (const [fieldId, value] of Object.entries(contextValues)) {
      extraValues[fieldId] = contextValueToCanonicalValue(fieldId, value, fields);
    }
  }

  if (observationFieldId) {
    extraValues[observationFieldId] = observation;
  }

  return Object.keys(extraValues).length > 0 ? extraValues : undefined;
}

function contextValueToCanonicalValue(
  fieldId: string,
  value: AttendanceContextValues[string],
  fields: AttendanceContextField[],
) {
  if (!value) {
    return null;
  }

  const field = fields.find((item) => item.id === fieldId);
  if (field?.type === "RELATION") return readAttendanceContextValue(field, value) ?? null;
  const optionId = typeof value === "string" ? value : typeof value === "object" && "optionId" in value ? value.optionId : null;
  const option = field?.options.find((item) => item.optionId === optionId || item.value === optionId);
  return option?.value ?? null;
}

export function canonicalAttendanceContextValue(field: AttendanceContextField | undefined, optionId: EntityRecordValue | undefined) {
  if (!optionId) return null;
  if (field?.type === "RELATION") {
    if (!getRelationTargetEntityTypeId(attendanceRelationField(field)) || isRelationFieldMultiple(attendanceRelationField(field))) throw new Error(`${field.name} no tiene un catálogo simple disponible. Actualiza la definición con conexión.`);
    const restored = readAttendanceContextValue(field, optionId);
    if (restored === null) return null;
    const recordId = typeof restored === "string" ? restored
      : restored && typeof restored === "object" && !Array.isArray(restored) && "id" in restored && typeof restored.id === "string" ? restored.id : null;
    if (!recordId) throw new Error(`${field.name} no tiene una relación simple válida.`);
    return recordId;
  }
  const option = field?.options.find((item) => item.optionId === optionId || item.value === optionId);
  if (!option?.value) throw new Error(`${field?.name ?? "Campo de contexto"} no tiene una opcion valida.`);
  return option.value;
}

export function attendanceContextFieldsFromPreparedDefinition(fields: EntityField[], contextFieldIds: string[]): AttendanceContextField[] {
  const fieldsById = new Map(fields.map(field => [field.id, field]));
  return contextFieldIds.flatMap(fieldId => {
    const field = fieldsById.get(fieldId);
    if (!field || (field.type !== "RELATION" && field.multiple) || field.active === false) return [];
    if (field.type === "RELATION" && !isRelationFieldMultiple(field) && getRelationTargetEntityTypeId(field)) {
      return [{ id: field.id, key: field.key, name: field.name, required: field.required, type: "RELATION", config: field.config } as AttendanceContextField];
    }
    if (field.type !== "SELECT") return [];
    return [{ id: field.id, key: field.key, name: field.name, required: field.required, type: "SELECT", options: (field.options ?? [])
      .filter(option => option.active !== false).map(option => ({ label: option.label, optionId: option.id, order: option.order, value: option.value })) } as AttendanceContextField];
  });
}

function attendanceLatestDedupeKey(item: AttendanceLatestItem) {
  return item.person.id || item.attendanceRecordId;
}
