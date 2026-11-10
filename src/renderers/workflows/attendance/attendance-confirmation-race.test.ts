// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { captureWorkflowWriteCommand, type WorkflowWriteContract } from "../../../lib/workflow-write-contract";
import { buildOfflineStateValues, stateUpdateIntentsEqual } from "../../../lib/state-update-offline";
import { attendanceStateFields } from "../../../lib/attendance-offline";
import { attendanceContextValidationErrors, attendanceEntryExtraValues } from "./attendance-workflow-logic";
import { attendanceAttemptKey, attendanceCommandKey, attendanceContentChanged, copyAttendanceEntry } from "./attendance-edit-command";

const path = process.env.ATTENDANCE_CONFLICT_HANDLER_SOURCE ?? `${process.cwd()}/src/renderers/workflows/attendance/AttendanceWorkflow.tsx`;
const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function evaluate(text: string, context: Record<string, unknown>) {
  const code = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), code)(...Object.values(context));
}
function actual(name: string, context: Record<string, unknown>) {
  let declaration: ts.FunctionDeclaration | undefined;
  const visit = (n: ts.Node) => { if (ts.isFunctionDeclaration(n) && n.name?.text === name) declaration = n; ts.forEachChild(n, visit); };
  visit(source);
  if (!declaration) throw new Error(`Missing real handler: ${name}`);
  return evaluate(`${declaration.getText(source)}; return ${name};`, context) as (...args: unknown[]) => Promise<void>;
}
// Execute the component's actual committed-input layout effect, rather than a copy of its guards.
function commitInputs(c: ReturnType<typeof fixture>) {
  let basis: ts.Expression | undefined;
  let effect: ts.ArrowFunction | undefined;
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(source) === "confirmationBasis") basis = n.initializer;
    if (ts.isCallExpression(n) && n.expression.getText(source) === "useLayoutEffect" && n.arguments[0] && ts.isArrowFunction(n.arguments[0]) && n.arguments[0].getText(source).includes("confirmationBasisRef")) effect = n.arguments[0];
    ts.forEachChild(n, visit);
  };
  visit(source);
  if (!basis || !effect) return; // RED control: the old component has no separate confirmation basis.
  const confirmationBasis = evaluate(`return (${basis.getText(source)});`, c) as string;
  evaluate(`(${effect.getText(source)})();`, { ...c, confirmationBasis });
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  const base = "2026-11-10T08:00:00.000Z";
  const fields = [{ id: "group", name: "Contexto", type: "SELECT" as const, required: true, options: [{ optionId: "first", value: "FIRST", label: "Primero" }] }];
  const config = { workflowKey: "attendance" as const, sourceEntityTypeId: "source", targetEntityTypeId: "target", personFieldId: "person", dateFieldId: "day", statusFieldId: "state", observationFieldId: "note", contextFieldIds: ["group"] };
  const cached = { localId: "local", serverId: "remote", syncStatus: "synced", remoteUpdatedAt: base, values: { appViewId: "view", subjectRecordId: "person", date: "2026-11-10" } };
  const c = { attendanceAttemptKey, attendanceCommandKey, attendanceContentChanged, copyAttendanceEntry, attendanceContextValidationErrors, attendanceEntryExtraValues, captureWorkflowWriteCommand, buildOfflineStateValues, stateUpdateIntentsEqual, attendanceStateFields,
    appView: { id: "view", config }, selectedContractId: "contract", ownerKey: "owner", date: "2026-11-10", isOnline: false, isSaving: false,
    selectedItem: { person: { id: "person", displayName: "Synthetic" }, attendance: { recordId: "remote", updatedAt: base, statusOptionId: "a", statusLabel: "A", observation: "Original", contextValues: { group: "first" } } },
    contextFields: fields, contextValues: { group: "first" }, supportsObservation: true, observation: "Edited", statuses: [],
    writePolicyConfigured: false, writeContract: null as WorkflowWriteContract | null | undefined, writeContractRequiredRef: { current: false },
    requestSequenceRef: { current: 0 }, confirmationSequenceRef: { current: 0 }, confirmationBasisRef: { current: "" }, draftRevisionRef: { current: 0 }, resolutionScope: "scope", resolutionScopeRef: { current: "scope" }, resolutionMountedRef: { current: true },
    saveInFlightRef: { current: false }, onlineAttemptsRef: { current: new Map() },
    setConflict: vi.fn(), setConfirmationError: vi.fn(), setError: vi.fn(), setContextErrors: vi.fn(), recordVisibleError: vi.fn(), saveEntry: vi.fn(),
    definitionCache: { getCachedRecord: vi.fn(async () => cached), listPendingStateUpdateOperations: vi.fn(async (): Promise<unknown[]> => []) }, cached,
  };
  commitInputs(c); return c;
}
const status = { optionId: "a", label: "A" };
async function open(c: ReturnType<typeof fixture>) { await actual("saveStatus", c)(status); expect(c.setConflict).toHaveBeenCalledOnce(); return c.setConflict.mock.calls[0][0]; }

describe("Attendance confirmation generation independent of background reads", () => {
  it("opens confirmation after a search advances the read sequence while SQLite is pending (archived RED)", async () => {
    const c = fixture(), wait = deferred<typeof c.cached>(); c.definitionCache.getCachedRecord.mockReturnValue(wait.promise);
    const saving = actual("saveStatus", c)(status); c.requestSequenceRef.current += 1; wait.resolve(c.cached); await saving;
    expect(c.setConflict).toHaveBeenCalledOnce(); expect(c.saveEntry).not.toHaveBeenCalled(); expect(c.setError).not.toHaveBeenCalled();
  });
  it("accepts a captured dialog after a background refresh advances only the read generation (archived RED)", async () => {
    const c = fixture(), conflict = await open(c); c.requestSequenceRef.current += 2;
    await actual("confirmConflict", { ...c, conflict })();
    expect(c.saveEntry).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ observation: "Edited", contextValues: { group: "first" }, statusOptionId: "a", overwrite: true, expectedUpdatedAt: c.cached.remoteUpdatedAt }));
  });
  it("does not retire a pending-intent lookup because of another read", async () => {
    const c = fixture(), wait = deferred<unknown[]>(); c.definitionCache.getCachedRecord.mockResolvedValue({ ...c.cached, syncStatus: "pending_update" }); c.definitionCache.listPendingStateUpdateOperations.mockReturnValue(wait.promise);
    const saving = actual("saveStatus", c)(status); await vi.waitFor(() => expect(c.definitionCache.listPendingStateUpdateOperations).toHaveBeenCalled()); c.requestSequenceRef.current++; wait.resolve([]); await saving;
    expect(c.saveEntry).toHaveBeenCalledOnce(); expect(c.saveEntry.mock.calls[0][0].overwrite).not.toBe(true);
  });
  it("a second click with stale isSaving cannot supersede an already-dispatched command", async () => {
    const c = fixture(), generation = c.confirmationSequenceRef.current; c.saveInFlightRef.current = true;
    await actual("saveStatus", c)(status);
    expect(c.confirmationSequenceRef.current).toBe(generation); expect(c.definitionCache.getCachedRecord).not.toHaveBeenCalled(); expect(c.saveEntry).not.toHaveBeenCalled();
  });
  it("cancellation invalidates an in-flight confirmation lookup", async () => {
    const c = fixture(), wait = deferred<typeof c.cached>(); c.definitionCache.getCachedRecord.mockReturnValue(wait.promise);
    const saving = actual("saveStatus", c)(status); await actual("cancelConflict", c)(); c.setConflict.mockClear(); wait.resolve(c.cached); await saving;
    expect(c.setConflict).not.toHaveBeenCalled(); expect(c.saveEntry).not.toHaveBeenCalled();
  });
  it("a newer explicit attempt supersedes an older lookup", async () => {
    const c = fixture(), first = deferred<typeof c.cached>(); c.definitionCache.getCachedRecord.mockReturnValueOnce(first.promise);
    const old = actual("saveStatus", c)(status); await actual("saveStatus", c)({ optionId: "b", label: "B" }); first.resolve(c.cached); await old;
    expect(c.setConflict).toHaveBeenCalledOnce(); expect(c.setConflict.mock.calls[0][0].requested.statusOptionId).toBe("b"); expect(c.saveEntry).not.toHaveBeenCalled();
  });
  it.each(["user", "contract", "view", "date", "revision", "unmount"])("retires the lookup after a real %s change", async change => {
    const c = fixture(), wait = deferred<typeof c.cached>(); c.definitionCache.getCachedRecord.mockReturnValue(wait.promise); const saving = actual("saveStatus", c)(status);
    if (change === "revision") c.draftRevisionRef.current++; else if (change === "unmount") c.resolutionMountedRef.current = false; else c.resolutionScopeRef.current = "new-" + change;
    wait.resolve(c.cached); await saving; expect(c.setConflict).not.toHaveBeenCalled(); expect(c.saveEntry).not.toHaveBeenCalled();
  });
  it.each(["base", "person", "authorization", "paused", "fingerprint"])("retires an open confirmation after committed %s changes", async change => {
    const c = fixture(); c.writeContract = { version: 1, configurationFingerprint: "a".repeat(64), authorized: true, acceptNewCommands: true, requiredCapabilities: ["relation-context-v1"] }; commitInputs(c); const conflict = await open(c);
    if (change === "base") c.selectedItem.attendance.updatedAt = "2026-11-10T09:00:00.000Z"; if (change === "person") c.selectedItem.person.id = "other"; if (change === "authorization") c.writeContract.authorized = false; if (change === "paused") c.writeContract.acceptNewCommands = false; if (change === "fingerprint") c.writeContract.configurationFingerprint = "b".repeat(64);
    commitInputs(c); await actual("confirmConflict", { ...c, conflict })(); expect(c.saveEntry).not.toHaveBeenCalled(); expect(c.setConflict).toHaveBeenLastCalledWith(null);
  });
  it("an equivalent metadata refresh or label does not withdraw consent", async () => {
    const c = fixture(), conflict = await open(c), generation = c.confirmationSequenceRef.current; c.selectedItem.person.displayName = "New label"; c.writeContract = undefined; commitInputs(c); c.requestSequenceRef.current++;
    expect(c.confirmationSequenceRef.current).toBe(generation); await actual("confirmConflict", { ...c, conflict })(); expect(c.saveEntry).toHaveBeenCalledOnce();
  });
  it("a superseded cache error cannot overwrite a newer draft", async () => {
    const c = fixture(), wait = deferred<typeof c.cached>(); c.definitionCache.getCachedRecord.mockReturnValue(wait.promise); const saving = actual("saveStatus", c)(status); c.draftRevisionRef.current++; wait.reject(new Error("old read error")); await saving;
    expect(c.setError).not.toHaveBeenCalled(); expect(c.recordVisibleError).not.toHaveBeenCalled();
  });
});
