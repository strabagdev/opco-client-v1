import { AttendanceBatchResult, AttendanceStatusOption } from "@/lib/opco-api";

export const ATTENDANCE_SEARCH_DEBOUNCE_MS = 300;

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
