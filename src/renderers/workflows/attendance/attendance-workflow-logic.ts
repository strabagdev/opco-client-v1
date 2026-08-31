import { AttendanceBatchResult, AttendanceContextField, AttendanceContextValues, AttendanceLatestItem, AttendanceResponse, AttendanceStatusOption, StateUpdateItem } from "@/lib/opco-api";

export const ATTENDANCE_SEARCH_DEBOUNCE_MS = 300;
// Mirrors the backend Attendance latest take=10 contract used to infer full-day snapshots.
export const ATTENDANCE_LATEST_LIMIT = 10;

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

export function sanitizeAttendanceContextSelections(
  fields: AttendanceContextField[],
  values: Record<string, string | null | undefined>,
) {
  return Object.fromEntries(fields.map((field) => {
    const optionId = values[field.id];
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
  return fields
    .filter((field) => field.required && !values[field.id])
    .map((field) => ({ fieldId: field.id, message: `${field.name} es obligatorio.` }));
}

export function attendanceContextExtraValues(
  fields: AttendanceContextField[],
  values: Record<string, string | null | undefined>,
) {
  return Object.fromEntries(fields
    .map((field) => {
      const optionId = values[field.id] ?? null;
      const option = optionId ? field.options.find((item) => item.optionId === optionId) : null;
      return [field.id, option?.value ?? optionId] as const;
    })
    .filter(([, value]) => value !== null));
}

function attendanceCurrentExtraValues(
  contextValues: AttendanceContextValues | undefined,
  fields: AttendanceContextField[],
  observationFieldId: string | undefined,
  observation: string | null,
) {
  const extraValues: Record<string, string | null> = {};

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

  const optionId = typeof value === "string" ? value : value.optionId;
  const field = fields.find((item) => item.id === fieldId);
  const option = field?.options.find((item) => item.optionId === optionId);

  return option?.value ?? optionId;
}

function attendanceLatestDedupeKey(item: AttendanceLatestItem) {
  return item.person.id || item.attendanceRecordId;
}
