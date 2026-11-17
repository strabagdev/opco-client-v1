// @ts-expect-error Node types intentionally absent from Expo application config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, it, expect, vi } from "vitest";
import { attendanceDailyCount } from "../../../lib/attendance-repetition";
const source = ts.createSourceFile("AttendanceWorkflow.tsx", readFileSync(`${process.cwd()}/src/renderers/workflows/attendance/AttendanceWorkflow.tsx`, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actual(name: string, c: Record<string, unknown>) {
    let node: ts.FunctionDeclaration | undefined;
    const visit = (n: ts.Node) => {
        if (ts.isFunctionDeclaration(n) && n.name?.text === name)
            node = n;
        ts.forEachChild(n, visit);
    };
    visit(source);
    if (!node)
        throw Error("Missing handler");
    return new Function(...Object.keys(c), ts.transpileModule(node.getText(source) + `;return ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(c)) as (...args: unknown[]) => Promise<void>;
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
        }[]), setContextErrors: vi.fn(), resolutionScope: "scope", resolutionScopeRef: { current: "scope" }, resolutionMountedRef: { current: true }, draftRevisionRef: { current: 0 }, confirmationSequenceRef: { current: 0 }, appView: { id: "view", config: { repetitionPolicy: "MULTIPLE_WITH_WARNING", targetEntityTypeId: "target" } }, eventCapturedAtRef: { current: "2026-11-16T10:00:00.000Z" }, editingTarget: null, captureWorkflowWriteCommand: () => ({}), writeContract: null, writeContractRequiredRef: { current: false }, supportsObservation: false, observation: "", date: "2026-11-16", definitionCache: { getAttendanceDailyRecords: vi.fn(async () => [{ syncStatus: "pending" }]) }, api: { getAttendanceWorkflow: vi.fn(async () => ({ appView: { id: "view" }, date: "2026-11-16", repetitionPolicy: "MULTIPLE_WITH_WARNING", items: [{ person: { id: "person" }, dailyRecordCount: 2 }] })) }, setRepeatChecking: vi.fn(), setError: vi.fn(), setConflict: vi.fn(), attendanceDailyCount, saveEntry: vi.fn(async () => { }), setRepeatWarning: vi.fn() };
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
