// @ts-expect-error Node types intentionally absent from Expo application config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, it, expect, vi } from "vitest";
import { attendanceDailyCount, attendanceHistoryMode } from "../../../lib/attendance-repetition";
const source = ts.createSourceFile("AttendanceWorkflow.tsx", readFileSync(`${process.cwd()}/src/renderers/workflows/attendance/AttendanceWorkflow.tsx`, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actual<T = void>(name: string, c: Record<string, unknown>) {
    let node: ts.FunctionDeclaration | undefined;
    const visit = (n: ts.Node) => {
        if (ts.isFunctionDeclaration(n) && n.name?.text === name)
            node = n;
        ts.forEachChild(n, visit);
    };
    visit(source);
    if (!node)
        throw Error("Missing handler");
    return new Function(...Object.keys(c), ts.transpileModule(node.getText(source) + `;return ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(c)) as (...args: unknown[]) => Promise<T>;
}
function fixture(online = false) {
    const c = { confirmationBasis: "basis", confirmationBasisRef: { current: "basis" }, selectedItem: { person: { id: "person", displayName: "Synthetic" }, attendance: null }, ownerKey: "owner", selectedContractId: "contract", isSaving: false, isOnline: online, token: "synthetic", saveInFlightRef: { current: false }, repeatCheckingRef: { current: false }, repeatWarning: null as null | {
            entry: unknown;
            scope: string;
            revision: number;
            generation: number;
            localCount: number;
            remoteCount?: number;
        }, contextFields: [], contextValues: { relation: "lot" }, attendanceContextValidationErrors: vi.fn(() => [] as {
            fieldId: string;
            message: string;
        }[]), setContextErrors: vi.fn(), resolutionScope: "scope", resolutionScopeRef: { current: "scope" }, resolutionMountedRef: { current: true }, draftRevisionRef: { current: 0 }, confirmationSequenceRef: { current: 0 }, appView: { id: "view", config: { repetitionPolicy: "MULTIPLE_WITH_WARNING", targetEntityTypeId: "target" } }, eventCapturedAtRef: { current: "2026-11-16T10:00:00.000Z" }, editingTarget: null, captureWorkflowWriteCommand: () => ({}), writeContract: null, writeContractRequiredRef: { current: false }, supportsObservation: false, observation: "", date: "2026-11-16", definitionCache: { getAttendanceDailyRecords: vi.fn(async () => [{ syncStatus: "pending" }]) }, api: { getAttendanceWorkflow: vi.fn(async () => ({ appView: { id: "view" }, date: "2026-11-16", repetitionPolicy: "MULTIPLE_WITH_WARNING", items: [{ person: { id: "person" }, dailyRecordCount: 2 }] })) }, setRepeatChecking: vi.fn(), setError: vi.fn(), setConflict: vi.fn(), attendanceDailyCount, attendanceHistoryMode, saveEntry: vi.fn(async () => { }), setRepeatWarning: vi.fn() };
    c.setRepeatWarning = vi.fn(value => { c.repeatWarning = value; });
    return c;
}
describe("actual Attendance repeat confirmation handlers", () => {
    it("does not queue before explicit confirmation, explains offline count, and allows cancellation", async () => { const c = fixture(); await actual("saveRepeatedStatus", c)({ optionId: "a", label: "A" }); expect(c.repeatWarning).toMatchObject({ localCount: 1, remoteCount: undefined }); expect(c.saveEntry).not.toHaveBeenCalled(); await actual("cancelRepeatedRecord", c)(); expect(c.repeatWarning).toBeNull(); expect(c.saveEntry).not.toHaveBeenCalled(); });
    it("uses an explicit warning offline even when this device knows zero records", async () => { const c = fixture(); c.definitionCache.getAttendanceDailyRecords.mockResolvedValue([]); await actual("saveRepeatedStatus", c)({ optionId: "a", label: "A" }); expect(c.repeatWarning).toMatchObject({ localCount: 0, remoteCount: undefined }); expect(c.saveEntry).not.toHaveBeenCalled(); });
    it("queries the server online even with local records and retains the captured context", async () => { const c = fixture(true); await actual("saveRepeatedStatus", c)({ optionId: "a", label: "A" }); expect(c.api.getAttendanceWorkflow).toHaveBeenCalledOnce(); expect(c.repeatWarning).toMatchObject({ remoteCount: 2, entry: { contextValues: { relation: "lot" } } }); await actual("confirmRepeatedRecord", c)(); expect(c.saveEntry).toHaveBeenCalledWith(expect.objectContaining({ repetitionPolicy: "MULTIPLE_WITH_WARNING", repetitionAcknowledged: true, contextValues: { relation: "lot" } })); });
    it("rejects a stale warning after scope or draft changes", async () => {
        for (const change of ["scope", "draft"]) {
            const c = fixture();
            await actual("saveRepeatedStatus", c)({ optionId: "a", label: "A" });
            if (change === "scope")
                c.resolutionScopeRef.current = "other";
            else
                c.draftRevisionRef.current++;
            await actual("confirmRepeatedRecord", c)();
            expect(c.saveEntry).not.toHaveBeenCalled();
        }
    });
    it("does not queue when online count fails or scope changes during SQLite", async () => { const c = fixture(true); c.api.getAttendanceWorkflow.mockRejectedValue(Error("Network failed")); await actual("saveRepeatedStatus", c)({ optionId: "a", label: "A" }); expect(c.setError).toHaveBeenCalled(); expect(c.saveEntry).not.toHaveBeenCalled(); expect(c.repeatWarning).toBeNull(); const d = fixture(); d.definitionCache.getAttendanceDailyRecords.mockImplementation(async () => { d.resolutionScopeRef.current = "other"; return []; }); await actual("saveRepeatedStatus", d)({ optionId: "a", label: "A" }); expect(d.repeatWarning).toBeNull(); expect(d.saveEntry).not.toHaveBeenCalled(); });
    it("enforces mandatory contexts before creating an intent", async () => { const c = fixture(); c.attendanceContextValidationErrors.mockReturnValue([{ fieldId: "relation", message: "required" }]); await actual("saveRepeatedStatus", c)({ optionId: "a", label: "A" }); expect(c.definitionCache.getAttendanceDailyRecords).not.toHaveBeenCalled(); expect(c.saveEntry).not.toHaveBeenCalled(); });
    it("creates without a warning only for the configured no-warning policy", async () => { const c = fixture(); c.appView.config.repetitionPolicy = "MULTIPLE"; await actual("saveRepeatedStatus", c)({ optionId: "a", label: "A" }); expect(c.saveEntry).toHaveBeenCalledOnce(); expect(c.repeatWarning).toBeNull(); });
    it("blocks the second immediate confirmation while the first is saving", async () => { const c = fixture(); await actual("saveRepeatedStatus", c)({ optionId: "a", label: "A" }); let done!: () => void; c.saveEntry.mockImplementation(() => { c.saveInFlightRef.current = true; return new Promise<void>(resolve => { done = resolve; }); }); const confirm = actual("confirmRepeatedRecord", c); const first = confirm(); await confirm(); expect(c.saveEntry).toHaveBeenCalledOnce(); done(); await first; });
});
it("refuses a stale rendered confirmation before starting a repeated capture", async () => { const c = fixture(); c.confirmationBasisRef.current = "new-basis"; await actual("saveRepeatedStatus", c)({ optionId: "a", label: "A" }); expect(c.definitionCache.getAttendanceDailyRecords).not.toHaveBeenCalled(); expect(c.saveEntry).not.toHaveBeenCalled(); });
it("commits and clears a multi-record draft before attempting delivery, retaining it on a sync failure", async () => {
    const { copyAttendanceEntry, attendanceAttemptKey } = await import("./attendance-edit-command");
    const { attendanceEntryToStateUpdateEntry, attendanceEntryExtraValues } = await import("./attendance-workflow-logic");
    const { workflowWriteMetadata } = await import("../../../lib/workflow-write-contract");
    const { attendanceStateFields } = await import("../../../lib/attendance-offline");
    const { OpcoApiError } = await import("../../../lib/opco-api");
    const events: string[] = [];
    const c = { selectedContractId: "contract", selectedItem: { person: { id: "person", displayName: "Synthetic" }, attendance: null }, ownerKey: "owner", isSaving: false, isOnline: true, token: "synthetic", date: "2026-11-16", resolutionScope: "scope", resolutionScopeRef: { current: "scope" }, resolutionMountedRef: { current: true }, draftRevisionRef: { current: 0 }, confirmationSequenceRef: { current: 0 }, saveInFlightRef: { current: false }, onlineAttemptsRef: { current: new Map() }, appView: { id: "view", name: "Synthetic", config: { targetEntityTypeId: "target", statusFieldId: "state" } }, contextFields: [], statuses: [{ optionId: "a", label: "A", isDefaultCheckIn: true }], copyAttendanceEntry, attendanceAttemptKey, attendanceEntryToStateUpdateEntry, attendanceEntryExtraValues, workflowWriteMetadata, attendanceStateFields, OpcoApiError,
        definitionCache: { saveStateUpdateLocally: vi.fn(async () => { events.push("persist"); return { localRecordId: "local-event", clientRequestId: "stable-key" }; }), getStateUpdateResolutionOutcome: vi.fn(async () => "pending") }, api: { saveStateUpdateWorkflow: vi.fn() }, syncPendingRecords: vi.fn(async () => { events.push("sync"); throw Error("Connection lost"); }), clearPersonFlow: vi.fn(), setIsSaving: vi.fn(), setError: vi.fn(), setRefreshError: vi.fn(), setSuccessMessage: vi.fn(), refreshLocalDayState: vi.fn(), refreshRecordsSyncSummary: vi.fn(), clearVisibleError: vi.fn(), reportWriteFeedback: vi.fn(), recordVisibleError: vi.fn(), conflict: null };
    c.clearPersonFlow.mockImplementation(() => { events.push("clear"); c.draftRevisionRef.current++; });
    await actual("saveEntry", c)({ personRecordId: "person", statusOptionId: "a", repetitionPolicy: "MULTIPLE", eventOccurredAt: "2026-11-16T10:00:00.000Z" });
    expect(events.slice(0, 3)).toEqual(["persist", "clear", "sync"]);
    expect(c.definitionCache.saveStateUpdateLocally).toHaveBeenCalledOnce();
    expect(c.api.saveStateUpdateWorkflow).not.toHaveBeenCalled();
    expect(c.reportWriteFeedback).not.toHaveBeenCalled();
    expect(c.setError).toHaveBeenCalledWith(expect.stringContaining("guardado localmente"));
    expect(c.saveInFlightRef.current).toBe(false);
});
it("resolves exact daily edits through the AppView/date projection, including after ACK", async () => {
  const c = fixture(true) as unknown as Record<string,any>;
  c.appView.config.statusFieldId="state";
  const item={person:{id:"person",displayName:"Synthetic"},attendance:{recordId:"remote-old",updatedAt:"2026-11-16T10:00:00.000Z",statusOptionId:"a",contextValues:{relation:"original"}}};
  c.definitionCache.getCachedRecord=vi.fn(async (scope:any)=>scope.appViewId==="view"&&scope.date==="2026-11-16"?{localId:"local-old",serverId:"remote-old",syncStatus:"synced"}:null);
  c.api.getAttendanceWorkflow.mockResolvedValue({...await c.api.getAttendanceWorkflow(),dailyRecords:[item]});
  Object.assign(c,{setEditingTarget:vi.fn(),setSelectedItem:vi.fn(),setContextValues:vi.fn(),setObservation:vi.fn(),cacheAttendanceRemoteSnapshot:vi.fn(),attendanceEditContextValues:()=>({relation:"original"})});
  await actual("editRepeatedRecord",c)(item);
  expect(c.setEditingTarget).toHaveBeenCalledWith({targetRecordId:"remote-old",targetLocalRecordId:"local-old"});
  expect(c.definitionCache.getCachedRecord).toHaveBeenCalledWith(expect.objectContaining({appViewId:"view",date:"2026-11-16",recordId:"remote-old"}));
});

function editFixture(recordId = "local-snapshot") {
  const c = fixture(true) as unknown as Record<string, any>;
  c.appView.config.statusFieldId = "state";
  const original = { person: { id: "person", displayName: "Synthetic" }, attendance: { recordId, updatedAt: "2026-11-16T10:00:00.000Z", statusOptionId: "a", contextValues: { relation: "original" } } };
  const remote = { ...original, attendance: { ...original.attendance, recordId: "remote-selected", statusOptionId: "b" } };
  c.definitionCache.getCachedRecord = vi.fn(async () => ({ localId: "local-snapshot", serverId: "remote-selected", syncStatus: "synced" }));
  c.api.getAttendanceWorkflow.mockResolvedValue({ appView: { id: "view" }, date: c.date, repetitionPolicy: "MULTIPLE_WITH_WARNING", dailyRecords: [
    { ...remote, attendance: { ...remote.attendance, recordId: "another-record", statusOptionId: "a" } }, remote,
  ] });
  c.api.getEntityRecord = vi.fn(async () => ({}));
  Object.assign(c, { setEditingTarget: vi.fn(), setSelectedItem: vi.fn(), setContextValues: vi.fn(), setObservation: vi.fn(), cacheAttendanceRemoteSnapshot: vi.fn(), attendanceEditContextValues: () => ({ relation: "original" }) });
  return { c, original, remote };
}

it("edits the exact server alias of a local snapshot instead of rejecting a present record", async () => {
  const { c, original, remote } = editFixture();
  await actual("editRepeatedRecord", c)(original);
  expect(c.setSelectedItem).toHaveBeenCalledWith(remote);
  expect(c.setEditingTarget).toHaveBeenCalledWith({ targetLocalRecordId: "local-snapshot", targetRecordId: "remote-selected" });
  expect(c.setError).not.toHaveBeenCalledWith(expect.stringContaining("ya no está disponible"));
});

it("never substitutes a different same-person record when the selected server alias is absent", async () => {
  const { c, original } = editFixture();
  const response = await c.api.getAttendanceWorkflow();
  c.api.getAttendanceWorkflow.mockResolvedValue({ ...response, dailyRecords: response.dailyRecords.slice(0, 1) });
  await actual("editRepeatedRecord", c)(original);
  expect(c.setSelectedItem).not.toHaveBeenCalled();
  expect(c.setEditingTarget).not.toHaveBeenCalled();
  expect(c.api.getEntityRecord).toHaveBeenCalledWith(c.token, c.selectedContractId, "target", "remote-selected");
  expect(c.setError).toHaveBeenCalledWith(expect.stringContaining("no aparece en esta persona o fecha"));
});

it("keeps permission/read failures and incompatible daily coverage distinct from a deleted record", async () => {
  const denied = editFixture();
  denied.c.api.getAttendanceWorkflow.mockRejectedValue(Error("No tienes permiso para consultar esta experiencia."));
  await actual("editRepeatedRecord", denied.c)(denied.original);
  expect(denied.c.setError).toHaveBeenCalledWith("No tienes permiso para consultar esta experiencia.");
  const missing = editFixture();
  missing.c.api.getAttendanceWorkflow.mockResolvedValue({ appView: { id: "view" }, date: missing.c.date, repetitionPolicy: "MULTIPLE_WITH_WARNING" });
  await actual("editRepeatedRecord", missing.c)(missing.original);
  expect(missing.c.setError).toHaveBeenCalledWith(expect.stringContaining("no incluyó los registros"));
  expect(missing.c.setSelectedItem).not.toHaveBeenCalled();
});

it("reads a complete exact group while preserving a pending edit and excluding deleted synced copies", async () => {
  const { stateUpdateItemToAttendanceItem } = await import("../../../lib/attendance-offline");
  const { c, remote } = editFixture();
  c.latest = [{person: remote.person}];
  c.contextFields = [];
  c.stateUpdateItemToAttendanceItem = stateUpdateItemToAttendanceItem;
  const local = (id: string, syncStatus: string) => ({localRecordId: "local-" + id, serverRecordId: id, syncStatus,
    subject: remote.person, stateValues: [{fieldId: "state", optionId: "a", label: "A local"}], extraValues: {}, updatedAt: remote.attendance.updatedAt});
  c.definitionCache.getAttendanceDailyRecords.mockResolvedValue([local("remote-selected", "pending_update"), local("deleted", "synced")]);
  const result = await actual<import("./attendance-record-list").AttendanceGroupRead>("readRecordGroup", c)("person");
  expect(result.complete).toBe(true);
  expect(result.records.map((r: any) => r.recordId)).toEqual(["another-record", "remote-selected"]);
  expect(result.records[1].statusLabel).toBe("A local");
});

it("reads groups offline only from the shared store and refuses a result from a retired scope", async () => {
  const { stateUpdateItemToAttendanceItem } = await import("../../../lib/attendance-offline");
  const { hasSuccessfulAttendanceDayHydration } = await import("../../../lib/attendance-snapshot-cache");
  const { c } = editFixture();
  Object.assign(c, { latest: [], contextFields: [], isOnline: false, stateUpdateItemToAttendanceItem, hasSuccessfulAttendanceDayHydration });
  c.definitionCache.getAttendanceDailyRecords.mockResolvedValue([]);
  c.definitionCache.getAttendanceDaySnapshotHydration = vi.fn(async () => null);
  expect(await actual("readRecordGroup", c)("person")).toEqual({records: [], complete: false});
  expect(c.api.getAttendanceWorkflow).not.toHaveBeenCalled();
  c.isOnline = true;
  c.api.getAttendanceWorkflow.mockImplementation(async () => { c.resolutionScopeRef.current = "other"; return {}; });
  await expect(actual("readRecordGroup", c)("person")).rejects.toThrow("experiencia cambió");
});

it("preserves Core missing and permission reasons for only the selected ID", async () => {
  for (const message of ["No se encontró el registro seleccionado.", "No tienes permiso para leer este registro."]) {
    const {c, original} = editFixture();
    const response = await c.api.getAttendanceWorkflow();
    c.api.getAttendanceWorkflow.mockResolvedValue({...response, dailyRecords: []});
    c.api.getEntityRecord.mockRejectedValue(Error(message));
    await actual("editRepeatedRecord", c)(original);
    expect(c.setError).toHaveBeenCalledWith(message);
    expect(c.setSelectedItem).not.toHaveBeenCalled();
    expect(c.setEditingTarget).not.toHaveBeenCalled();
    expect(c.api.getEntityRecord).toHaveBeenCalledWith(c.token, c.selectedContractId, "target", "remote-selected");
  }
});

it("never opens a detached server-only edit when its exact local copy cannot be prepared", async () => {
  const { c, original } = editFixture("remote-selected");
  c.definitionCache.getCachedRecord.mockResolvedValue(null);
  await actual("editRepeatedRecord", c)(original);
  expect(c.setEditingTarget).not.toHaveBeenCalled();
  expect(c.setSelectedItem).not.toHaveBeenCalled();
  expect(c.setError).toHaveBeenCalledWith(expect.stringContaining("copia local del registro seleccionado"));
});

it("edits an acknowledged pending creation without asking to create another or changing its capture", async () => {
  const c = fixture() as unknown as Record<string, any>;
  c.editingTarget = {targetLocalRecordId:"pending-selected",eventOccurredAt:"2026-11-16T09:00:00.000Z",repetitionAcknowledged:true};
  await actual("saveRepeatedStatus", c)({optionId:"b",label:"B"});
  expect(c.saveEntry).toHaveBeenCalledWith(expect.objectContaining({...c.editingTarget,statusOptionId:"b"}));
  expect(c.setRepeatWarning).not.toHaveBeenCalled();
  expect(c.definitionCache.getAttendanceDailyRecords).not.toHaveBeenCalled();
  delete c.editingTarget.repetitionAcknowledged;
  c.saveEntry.mockClear();
  await actual("saveRepeatedStatus", c)({optionId:"b",label:"B"});
  expect(c.saveEntry).not.toHaveBeenCalled();
  expect(c.setError).toHaveBeenCalledWith(expect.stringContaining("intención original"));
});

it("retains only the selected pending creation's original acknowledgement and timestamp", async () => {
  const { c, original } = editFixture("pending-selected");
  c.isOnline=false;
  const values={appViewId:"view",subjectRecordId:"person",date:c.date,eventOccurredAt:"2026-11-16T09:00:00.000Z",repetitionAcknowledged:true};
  c.definitionCache.getCachedRecord.mockResolvedValue({localId:"pending-selected",serverId:null,syncStatus:"pending_create",values});
  c.normalizeStateUpdateRecord=()=>({subject:original.person,stateValues:[],extraValues:{}});
  c.stateUpdateItemToAttendanceItem=()=>original;
  await actual("editRepeatedRecord", c)(original);
  expect(c.setEditingTarget).toHaveBeenCalledWith({targetLocalRecordId:"pending-selected",eventOccurredAt:values.eventOccurredAt,repetitionAcknowledged:true});
  expect(c.api.getAttendanceWorkflow).not.toHaveBeenCalled();
});

it("reads default one-per-day groups using their update-current storage projection offline", async () => {
  const {stateUpdateItemToAttendanceItem} = await import("../../../lib/attendance-offline");
  const {hasSuccessfulAttendanceDayHydration} = await import("../../../lib/attendance-snapshot-cache");
  const {c,remote}=editFixture();
  delete c.appView.config.repetitionPolicy;
  Object.assign(c,{latest:[{person:remote.person}],contextFields:[],isOnline:false,stateUpdateItemToAttendanceItem,hasSuccessfulAttendanceDayHydration});
  c.definitionCache.getAttendanceDailyRecords.mockImplementation(async (scope: {historyMode?: string}) => scope.historyMode === "update-current" ? [{localRecordId:"one-local",serverRecordId:"one-server",subject:remote.person,stateValues:[{fieldId:"state",label:"A",optionId:"a"}],extraValues:{},updatedAt:remote.attendance.updatedAt,syncStatus:"synced"}] : []);
  c.definitionCache.getAttendanceDaySnapshotHydration=vi.fn(async()=>({lastSuccessfulRefreshAt:"2026-11-16T12:00:00Z"}));
  const result=await actual<import("./attendance-record-list").AttendanceGroupRead>("readRecordGroup",c)("person");
  expect(result.records.map(r=>r.recordId)).toEqual(["one-server"]);
  expect(result.complete).toBe(true);
  expect(c.api.getAttendanceWorkflow).not.toHaveBeenCalled();
});
