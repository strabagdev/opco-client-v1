// @ts-expect-error Node types intentionally absent from the Expo application config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { isAttendanceRequestCurrent } from "./attendance-workflow-logic";

// Execute the actual background handler. Real input/focus/OPFS is checked separately.
function handler(env: Record<string, unknown>) {
  const src = ts.createSourceFile("AttendanceWorkflow.tsx", readFileSync("src/renderers/workflows/attendance/AttendanceWorkflow.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Node | undefined;
  function find(n: ts.Node) { if (ts.isVariableDeclaration(n) && n.name.getText(src) === "loadDay" && n.initializer && ts.isCallExpression(n.initializer)) callback = n.initializer.arguments[0]; ts.forEachChild(n, find); } find(src);
  if (!callback) throw Error("Actual loadDay handler missing");
  return new Function(...Object.keys(env), ts.transpileModule("const handler=" + callback.getText(src) + ";", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + ";return handler;")(...Object.values(env));
}
function fixture() {
  const response = { latest: [], summary: { totalRegistered: 3 } };
  const e: any = { token: "synthetic", selectedContractId: "contract", status: "authenticated", isContractBootstrapPending: false,
    api: { getAttendanceWorkflow: vi.fn(async () => response) }, appView: { id: "view" }, date: "2026-11-26", requestSequenceRef: { current: 1 },
    beginLoadingRequest: vi.fn(() => 1), finishLoadingRequest: vi.fn(), isAttendanceRequestCurrent,
    cacheAttendanceOnlineResponse: vi.fn(async () => {}), applyAttendanceResponse: vi.fn(), refreshLocalDayState: vi.fn(async () => {}),
    setError: vi.fn(), setRefreshError: vi.fn(), setSuccessMessage: vi.fn(), setIsLoading: vi.fn(), setItems: vi.fn(),
    clearVisibleError: vi.fn(), recordVisibleError: vi.fn(), stateUpdateRefreshErrorMessage: () => "Could not refresh" };
  return e;
}
describe("background day refresh does not own a compatible person search", () => {
  it("updates the day without emptying existing search results", async () => {
    const e = fixture(); await handler(e)({ operation: "refresh" });
    expect(e.applyAttendanceResponse).toHaveBeenCalledOnce(); expect(e.refreshLocalDayState).toHaveBeenCalledOnce();
    expect(e.setItems).not.toHaveBeenCalled(); expect(e.finishLoadingRequest).toHaveBeenCalledWith(1);
  });
  it("keeps compatible results and exposes an actual refresh failure", async () => {
    const e = fixture(); e.api.getAttendanceWorkflow.mockRejectedValue(new Error("synthetic outage")); await handler(e)({ operation: "refresh" });
    expect(e.setItems).not.toHaveBeenCalled(); expect(e.recordVisibleError).toHaveBeenCalledOnce(); expect(e.setRefreshError).toHaveBeenCalledWith("Could not refresh");
  });
  it("ignores a retired scope response without updating its successor", async () => {
    const e = fixture(); let resolve!: (x: unknown) => void; e.api.getAttendanceWorkflow.mockImplementation(() => new Promise(r => { resolve = r; }));
    let current = true; const pending = handler(e)({ operation: "refresh", isCurrent: () => current }); current = false; resolve({}); await pending;
    expect(e.applyAttendanceResponse).not.toHaveBeenCalled(); expect(e.setItems).not.toHaveBeenCalled(); expect(e.finishLoadingRequest).not.toHaveBeenCalled();
  });
});


function initialRead(env: Record<string, unknown>) {
  const src = ts.createSourceFile("AttendanceWorkflow.tsx", readFileSync("src/renderers/workflows/attendance/AttendanceWorkflow.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let node: ts.FunctionDeclaration | undefined;
  function find(n: ts.Node) { if (ts.isFunctionDeclaration(n) && n.name?.text === "load" && n.getText(src).includes("let localReady")) node = n; ts.forEachChild(n, find); } find(src);
  if (!node) throw Error("Actual initial read missing");
  return new Function(...Object.keys(env), ts.transpileModule(node.getText(src) + ";return load;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(env));
}
describe("a superseded metadata read releases its own visual indicator", () => {
  it.each([true, false])("releases only when its form remains mounted=%s", async isMounted => {
    const e = fixture(); e.ownerKey = "org:A"; e.appView.config = { sourceEntityTypeId: "people" }; e.isMounted = true;
    let resolve!: (x: unknown) => void;
    e.definitionCache = { getAppViewDefinition: vi.fn(() => new Promise(r => { resolve = r; })), getEntityDefinition: vi.fn(async () => ({})), getSyncTelemetry: vi.fn(async () => ({})) };
    // The outer effect supplies the mounted guard; another search already
    // superseded this request, independently from its visual loading identity.
    e.requestSequenceRef.current = 2;
    const env = { ...e, isMounted };
    if (!isMounted) {
      const task = initialRead(env)(); resolve(null); await task;
      expect(e.finishLoadingRequest).not.toHaveBeenCalled();
    } else {
      const task = initialRead(env)(); resolve(null); await task;
      expect(e.finishLoadingRequest).toHaveBeenCalledWith(1);
    }
    expect(e.api.getAttendanceWorkflow).not.toHaveBeenCalled(); expect(e.setItems).not.toHaveBeenCalled();
  });
});
