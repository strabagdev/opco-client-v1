// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { stateUpdateResolutionFeedback } from "../state-update/state-update-workflow-logic";

// Execute the actual renderer handlers without a DOM/native renderer. Persistence is covered separately.
const sourcePath = process.env.ATTENDANCE_CONFLICT_HANDLER_SOURCE ?? `${process.cwd()}/src/renderers/workflows/attendance/AttendanceWorkflow.tsx`;
const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name: string, context: Record<string, unknown>) {
  let declaration: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!declaration) throw new Error(`Renderer handler missing: ${name}`);
  const code = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), `${code}; return ${name};`)(...Object.values(context)) as (record: typeof selected) => Promise<void>;
}
const selected = { localRecordId: "selected-attendance", conflictIdentity: "selected-snapshot-request", person: { id: "person", displayName: "Persona" },
  statusOptionId: "local", contextValues: {}, observation: null, conflictRemoteUpdatedAt: "remote-version" };
function fixture(outcome = "confirmed") {
  return {
    ownerKey: "local:user", selectedContractId: "contract", appView: { id: "view", name: "Fixture", config: { targetEntityTypeId: "target", statusFieldId: "state" } },
    date: "2026-10-03", isSaving: false, isOnline: true, statuses: [], contextFields: [],
    requestSequenceRef: { current: 0 }, resolutionInFlightRef: { current: false }, resolutionMountedRef: { current: true },
    resolutionScope: "selected-scope", resolutionScopeRef: { current: "selected-scope" },
    attendanceEntryExtraValues: vi.fn(() => ({})), attendanceStateFields: vi.fn(() => []),
    definitionCache: {
      saveStateUpdateLocally: vi.fn(async () => ({ localRecordId: selected.localRecordId, clientRequestId: "overwrite-request" })),
      resolveStateUpdateConflictWithLocal: vi.fn(async () => ({ localRecordId: selected.localRecordId, clientRequestId: "overwrite-request" })),
      getStateUpdateResolutionOutcome: vi.fn(async () => outcome),
    },
    syncPendingRecords: vi.fn(async () => undefined), refreshRecordsSyncSummary: vi.fn(async () => undefined),
    refreshLocalDayState: vi.fn(async () => undefined), clearVisibleError: vi.fn(), reportWriteFeedback: vi.fn(), recordVisibleError: vi.fn(),
    setIsSaving: vi.fn(), setError: vi.fn(), setRefreshError: vi.fn(), setSuccessMessage: vi.fn(), setResolutionFeedback: vi.fn(), stateUpdateResolutionFeedback,
  };
}
describe("Attendance selected conflict feedback", () => {
  it.each(["failed", "pending", "conflict", "superseded"])("another operation succeeding cannot confirm selected %s intent", async (outcome) => {
    const context = fixture(outcome);
    await handler("handleUseLocalConflictChange", context)(selected);
    expect(context.reportWriteFeedback.mock.calls.some(([feedback]) => feedback.kind === "server-confirmed")).toBe(false);
    expect(context.setResolutionFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ outcome }));
    expect(context.definitionCache.getStateUpdateResolutionOutcome).toHaveBeenCalledWith({
      appViewId: "view", contractId: "contract", date: "2026-10-03", ownerKey: "local:user", targetEntityTypeId: "target",
      localRecordId: selected.localRecordId, clientRequestId: "overwrite-request",
    });
    expect(context.definitionCache.resolveStateUpdateConflictWithLocal).toHaveBeenCalledWith(expect.objectContaining({
      conflictIdentity: selected.conflictIdentity, localRecordId: selected.localRecordId, subjectRecordId: "person",
    }));
  });
  it("transport failure still reads durable pending outcome", async () => {
    const context = fixture("pending");
    context.syncPendingRecords.mockRejectedValue(new Error("transport down"));
    await handler("handleUseLocalConflictChange", context)(selected);
    expect(context.definitionCache.getStateUpdateResolutionOutcome).toHaveBeenCalledOnce();
    expect(context.reportWriteFeedback).toHaveBeenCalledWith(expect.objectContaining({ kind: "local-saved" }));
    expect(context.setResolutionFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: "pending" }));
  });
  it("confirms only the selected receipt after a real confirmation", async () => {
    const context = fixture();
    await handler("handleUseLocalConflictChange", context)(selected);
    expect(context.definitionCache.getStateUpdateResolutionOutcome).toHaveBeenCalledOnce();
    expect(context.reportWriteFeedback).toHaveBeenCalledWith(expect.objectContaining({ kind: "server-confirmed" }));
  });
  it("offline resolution remains pending", async () => {
    const context = { ...fixture("pending"), isOnline: false };
    await handler("handleUseLocalConflictChange", context)(selected);
    expect(context.syncPendingRecords).not.toHaveBeenCalled();
    expect(context.setResolutionFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: "pending" }));
  });
  it("a new edit while sync waits supersedes the selected receipt without confirmation", async () => {
    const context = fixture();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const inFlight = new Promise<void>((resolve) => { started = resolve; });
    context.syncPendingRecords.mockImplementation(async () => { started(); await waiting; });
    const resolution = handler("handleUseLocalConflictChange", context)(selected);
    await inFlight;
    // Persistence/engine tests separately prove the durable successor survives this interleaving.
    context.definitionCache.getStateUpdateResolutionOutcome.mockResolvedValue("superseded");
    release();
    await resolution;
    expect(context.definitionCache.getStateUpdateResolutionOutcome).toHaveBeenCalledWith(expect.objectContaining({
      localRecordId: selected.localRecordId, clientRequestId: "overwrite-request",
    }));
    expect(context.reportWriteFeedback).not.toHaveBeenCalled();
    expect(context.setResolutionFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: "superseded" }));
  });
  it.each(["scope", "unmount"])("late response after %s cannot publish selected feedback", async (change) => {
    const context = fixture();
    context.syncPendingRecords.mockImplementation(async () => {
      if (change === "scope") context.resolutionScopeRef.current = "other-scope";
      else context.resolutionMountedRef.current = false;
    });
    await handler("handleUseLocalConflictChange", context)(selected);
    expect(context.reportWriteFeedback).not.toHaveBeenCalled();
    expect(context.refreshLocalDayState).not.toHaveBeenCalled();
  });
});
