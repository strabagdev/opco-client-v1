import { attendanceStateFields } from "./attendance-offline";
import { attendanceResponseToStateUpdateItems, isAttendanceRemoteSnapshotComplete } from "../renderers/workflows/attendance/attendance-workflow-logic";
import { AttendanceResponse, AttendanceWorkflowConfig, OpcoApi } from "./opco-api";
import { AttendanceDaySnapshotHydration, AttendanceDaySnapshotScope, StateUpdateOfflineStore } from "./state-update-offline";

export type AttendanceMonthStatus = "complete" | "partial" | "none";

export type CacheAttendanceRemoteSnapshotInput = {
  appViewId: string;
  config: Pick<AttendanceWorkflowConfig, "contextFieldIds" | "observationFieldId" | "statusFieldId"> & Partial<Pick<AttendanceWorkflowConfig, "personFieldId" | "dateFieldId">>;
  contractId: string;
  ownerKey: string;
  response: AttendanceResponse;
  snapshotComplete?: boolean;
  store: Pick<StateUpdateOfflineStore, "markAttendanceDaySnapshotHydrated" | "upsertStateUpdateSnapshot">;
};

// After an ACK only the day's attendance changed. Its complete DTO can be persisted
// independently of an unrelated refresh of the already prepared people list.
export async function refreshAttendanceDaySnapshot(input: Omit<CacheAttendanceRemoteSnapshotInput, "response" | "snapshotComplete"> & {
  api: Pick<OpcoApi, "getAttendanceWorkflow">;
  date: string;
  token: string;
  isCurrent(): boolean;
}) {
  const response = await input.api.getAttendanceWorkflow(input.token, input.contractId, input.appViewId, { date: input.date });
  if (!input.isCurrent()) return null;
  if (response.date !== input.date) throw new Error("Opco devolvio asistencia para una fecha diferente.");
  let hydration = await cacheAttendanceRemoteSnapshot({ ...input, response });
  const completeDay = isAttendanceRemoteSnapshotComplete(response);
  if (completeDay && !hydration.complete && input.config.observationFieldId) {
    // latest omits Observation. Fetch current via the existing person endpoint, not
    // from an ACK or an old version. Serial reads are bounded by the day limit (10).
    const items = [...response.items];
    for (const personId of new Set(response.latest.map(event => event.person.id))) {
      if (!input.isCurrent()) return null;
      const current = await input.api.getAttendanceWorkflow(input.token, input.contractId, input.appViewId, {
        date: input.date, personRecordId: personId,
      });
      if (!input.isCurrent()) return null;
      if (current.date !== input.date) throw new Error("Opco devolvio asistencia para una fecha diferente.");
      items.push(...current.items.filter(item => item.person.id === personId));
    }
    hydration = await cacheAttendanceRemoteSnapshot({ ...input, response: { ...response, items } });
  }
  if (completeDay && !hydration.complete) {
    throw new Error("No se pudo verificar el contenido completo de asistencia para este dia.");
  }
  return { response, hydration };
}

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
  // Keep the endpoint's current authoritative and every distinct latest event. Converting
  // the whole response into a map by person would replace current and discard other IDs.
  const items = attendanceResponseToStateUpdateItems({ ...response, latest: [] }, config);
  const latest = response.latest.flatMap(event => {
    const item = attendanceResponseToStateUpdateItems({ ...response, items: [], latest: [event] }, config)[0];
    if (!item?.current) return [];
    return [{ ...item.current, date: response.date, subject: item.subject }];
  });
  const subjectsWithCurrentResponse = new Set(items.map(item => item.subject.id));
  for (const event of latest) {
    if (subjectsWithCurrentResponse.has(event.subject.id)) continue;
    // Core already orders Attendance latest by the same criterion as current. Use its
    // first representation only when that subject was not included in this response.
    items.push({ subject: event.subject, current: event });
    subjectsWithCurrentResponse.add(event.subject.id);
  }
  const result = await store.upsertStateUpdateSnapshot({
    appViewId,
    complete,
    contractId,
    date: response.date,
    projectionDefinition: {
      sourceEntityTypeId: response.sourceEntityType.id, subjectFieldId: config.personFieldId, dateFieldId: config.dateFieldId,
      stateFields: attendanceStateFields(response.statuses, { statusFieldId: config.statusFieldId }),
      extraFields: response.contextFields?.map(f => ({ id: f.id, required: f.required })), observationFieldId: config.observationFieldId,
    },
    items,
    latest,
    expectedRemoteEventCount: complete ? response.summary.totalRegistered : undefined,
    ownerKey,
    targetEntityTypeId,
  });

  const persistedComplete = complete && result.contentVerified === true;
  if (persistedComplete) {
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
    complete: persistedComplete,
    lastSuccessfulRefreshAt: persistedComplete ? refreshedAt : null,
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
