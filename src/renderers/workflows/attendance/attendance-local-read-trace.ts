import type { StateUpdateScope } from "../../../lib/state-update-offline";

type TraceScope = Pick<StateUpdateScope, "ownerKey" | "contractId" | "appViewId" | "targetEntityTypeId" | "date"> & { subjectRecordId?: string };
type Trace = { scope: TraceScope; source: string; at: string; count: number; ids: string[]; truncated: boolean; published?: boolean };
const traces: Trace[] = [];
/** Bounded, process-local observation. No storage, telemetry upload, business values or auth tokens. */
export function recordAttendanceLocalRead(scope: TraceScope, source: string, ids: string[], published?: boolean, recordCount = ids.length) {
  traces.push({ scope: { ...scope }, source, at: new Date().toISOString(), count: recordCount,
    ids: ids.slice(0, 2000), truncated: ids.length > 2000, published });
  if (traces.length > 30) traces.splice(0, traces.length - 30);
}
export function inspectAttendanceLocalReadTrace(scope: TraceScope, localId: string, serverId: string | null, subjectRecordId?: string) {
  return traces.filter(trace => trace.scope.ownerKey === scope.ownerKey && trace.scope.contractId === scope.contractId &&
    trace.scope.appViewId === scope.appViewId && trace.scope.targetEntityTypeId === scope.targetEntityTypeId && trace.scope.date === scope.date)
    .map(trace => {
      const found = trace.ids.some(id => id === localId || !!serverId && id === serverId);
      return { source: trace.source, at: trace.at, count: trace.count, published: trace.published ?? null,
        subjectMatches: trace.scope.subjectRecordId === undefined ? null : trace.scope.subjectRecordId === subjectRecordId,
        selectedIncluded: found ? true : trace.truncated ? null : false, identityListTruncated: trace.truncated };
    });
}
