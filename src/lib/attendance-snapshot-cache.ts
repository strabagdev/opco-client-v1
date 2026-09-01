import { attendanceResponseToStateUpdateItems, isAttendanceRemoteSnapshotComplete } from "../renderers/workflows/attendance/attendance-workflow-logic";
import { AttendanceResponse, AttendanceWorkflowConfig } from "./opco-api";
import { AttendanceDaySnapshotHydration, AttendanceDaySnapshotScope, StateUpdateOfflineStore } from "./state-update-offline";

export type AttendanceMonthStatus = "complete" | "partial" | "none";

export type CacheAttendanceRemoteSnapshotInput = {
  appViewId: string;
  config: Pick<AttendanceWorkflowConfig, "contextFieldIds" | "observationFieldId" | "statusFieldId">;
  contractId: string;
  ownerKey: string;
  response: AttendanceResponse;
  snapshotComplete?: boolean;
  store: Pick<StateUpdateOfflineStore, "markAttendanceDaySnapshotHydrated" | "upsertStateUpdateSnapshot">;
};

export async function cacheAttendanceRemoteSnapshot({
  appViewId,
  config,
  contractId,
  ownerKey,
  response,
  snapshotComplete,
  store,
}: CacheAttendanceRemoteSnapshotInput) {
  const complete = snapshotComplete ?? isAttendanceRemoteSnapshotComplete(response);
  const refreshedAt = new Date().toISOString();
  const targetEntityTypeId = response.targetEntityType.id;
  const result = await store.upsertStateUpdateSnapshot({
    appViewId,
    complete,
    contractId,
    date: response.date,
    items: attendanceResponseToStateUpdateItems(response, config),
    ownerKey,
    targetEntityTypeId,
  });

  if (complete) {
    await store.markAttendanceDaySnapshotHydrated({
      appViewId,
      contractId,
      date: response.date,
      ownerKey,
      refreshedAt,
      targetEntityTypeId,
    });
  }

  return {
    complete,
    lastSuccessfulRefreshAt: complete ? refreshedAt : null,
    staleSyncedRemoved: result.staleSyncedRemoved,
  };
}

export function hasSuccessfulAttendanceDayHydration(
  hydration?: Pick<AttendanceDaySnapshotHydration, "lastSuccessfulRefreshAt"> | null,
) {
  return typeof hydration?.lastSuccessfulRefreshAt === "string" && hydration.lastSuccessfulRefreshAt.length > 0;
}

export function deriveAttendanceMonthStatus(
  hydrations: (Pick<AttendanceDaySnapshotHydration, "lastSuccessfulRefreshAt"> | null | undefined)[],
): AttendanceMonthStatus {
  const hydratedCount = hydrations.filter(hasSuccessfulAttendanceDayHydration).length;

  if (hydrations.length > 0 && hydratedCount === hydrations.length) {
    return "complete";
  }

  return hydratedCount > 0 ? "partial" : "none";
}

export function currentMonthDateKeys(anchor: Date) {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  return Array.from({ length: daysInMonth }, (_, index) => formatLocalDateInput(new Date(year, month, index + 1)));
}

export function attendanceDaySnapshotScopeKey({
  appViewId,
  contractId,
  date,
  ownerKey,
  targetEntityTypeId,
}: AttendanceDaySnapshotScope) {
  return [ownerKey, contractId, appViewId, targetEntityTypeId, date].join(":");
}

function formatLocalDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
