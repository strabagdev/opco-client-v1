import { AttendanceBatchResult, AttendanceResponse, AttendanceStatusOption, StateUpdateItem } from "@/lib/opco-api";

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

export function attendanceResponseToStateUpdateItems(
  response: AttendanceResponse,
  config: {
    observationFieldId?: string;
    statusFieldId: string;
  },
): StateUpdateItem[] {
  const items = new Map<string, StateUpdateItem>();

  for (const item of response.items) {
    items.set(item.person.id, {
      current: item.attendance
        ? {
            extraValues: config.observationFieldId
              ? { [config.observationFieldId]: item.attendance.observation }
              : undefined,
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
        recordId: item.attendanceRecordId,
        stateValues: [{
          fieldId: config.statusFieldId,
          label: item.statusLabel,
          optionId: item.statusOptionId,
        }],
        updatedAt: item.updatedAt ?? response.date,
      },
      subject: item.person,
    });
  }

  return [...items.values()];
}
