// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { stateUpdateResolutionFeedback } from "./state-update-workflow-logic";

// Execute the actual renderer handlers without a DOM/native renderer. Persistence is covered separately.
const sourcePath = process.env.STATE_UPDATE_CONFLICT_HANDLER_SOURCE ?? `${process.cwd()}/src/renderers/workflows/state-update/StateUpdateWorkflow.tsx`;
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
const selected = { localRecordId: "selected-append", conflictIdentity: "selected-snapshot-request", subject: { id: "subject", displayName: "Sujeto" },
  stateValues: [{ fieldId: "state", optionId: "local", label: "Local" }], extraValues: { note: "Seleccionado" }, conflictRemoteUpdatedAt: "remote-version" };
function fixture(outcome = "confirmed") {
  return {
    ownerKey: "local:user", selectedContractId: "contract", appView: { id: "view", name: "Fixture" },
    response: { historyMode: "append", uniqueness: "none", stateFields: [], targetEntityType: { id: "target" } },
    date: "2026-10-03", hasDate: true, isSaving: false, isOnline: true,
    requestSequenceRef: { current: 0 }, resolutionInFlightRef: { current: false }, resolutionMountedRef: { current: true },
    resolutionScope: "selected-scope", resolutionScopeRef: { current: "selected-scope" },
    definitionCache: {
      resolveStateUpdateConflictWithLocal: vi.fn(async () => ({ localRecordId: selected.localRecordId, clientRequestId: "overwrite-request" })),
      discardStateUpdateLocalChange: vi.fn(async () => undefined),
      getStateUpdateResolutionOutcome: vi.fn(async () => outcome),
    },
    syncPendingRecords: vi.fn(async () => undefined), refreshRecordsSyncSummary: vi.fn(async () => undefined),
    loadWorkflow: vi.fn(async () => undefined), reportWriteFeedback: vi.fn(), recordVisibleError: vi.fn(),
    setIsSaving: vi.fn(), setError: vi.fn(), setRefreshError: vi.fn(), setSuccessMessage: vi.fn(), setConflict: vi.fn(),
    setResolutionFeedback: vi.fn(), stateUpdateResolutionFeedback,
  };
}
describe("selected conflict renderer handlers", () => {
  it.each(["pending", "conflict", "failed", "superseded"])("global sync completion does not confirm selected %s intent", async (outcome) => {
    const context = fixture(outcome);
    await handler("handleUseLocalConflictChange", context)(selected);
    expect(context.syncPendingRecords).toHaveBeenCalledOnce();
    expect(context.reportWriteFeedback.mock.calls.some(([feedback]) => feedback.kind === "server-confirmed")).toBe(false);
    expect(context.setResolutionFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ outcome }));
    expect(context.definitionCache.getStateUpdateResolutionOutcome).toHaveBeenCalledWith(expect.objectContaining({
      localRecordId: "selected-append", clientRequestId: "overwrite-request", ownerKey: "local:user", contractId: "contract", appViewId: "view", targetEntityTypeId: "target", date: "2026-10-03",
    }));
  });
  it("announces confirmation only after reading the selected durable receipt", async () => {
    const context = fixture();
    await handler("handleUseLocalConflictChange", context)(selected);
    expect(context.definitionCache.getStateUpdateResolutionOutcome).toHaveBeenCalledOnce();
    expect(context.reportWriteFeedback).toHaveBeenCalledWith(expect.objectContaining({ kind: "server-confirmed" }));
    expect(context.setSuccessMessage).toHaveBeenLastCalledWith("Cambio confirmado por Opco.");
  });
  it("Use Opco passes the durable selection and reports local resolution without syncing", async () => {
    const context = fixture();
    await handler("handleUseRemoteConflictChange", context)(selected);
    expect(context.definitionCache.discardStateUpdateLocalChange).toHaveBeenCalledWith({
      localRecordId: selected.localRecordId, conflictIdentity: selected.conflictIdentity, ownerKey: "local:user", contractId: "contract", appViewId: "view", targetEntityTypeId: "target", subjectRecordId: "subject", date: "2026-10-03",
    });
    expect(context.syncPendingRecords).not.toHaveBeenCalled();
    expect(context.reportWriteFeedback).not.toHaveBeenCalled();
    expect(context.setResolutionFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: "local" }));
  });
  it("a late completion after leaving the selected scope cannot publish feedback", async () => {
    const context = fixture();
    context.syncPendingRecords.mockImplementation(async () => { context.resolutionScopeRef.current = "another-view"; });
    await handler("handleUseLocalConflictChange", context)(selected);
    expect(context.reportWriteFeedback).not.toHaveBeenCalled();
    expect(context.setSuccessMessage.mock.calls.filter(([message]) => message !== null)).toHaveLength(0);
    expect(context.loadWorkflow).not.toHaveBeenCalled();
  });
});
