// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldHandleStateUpdateRefresh } from "../../../state/state-update-refresh";
import { createStateUpdateVisibleErrorDiagnostics } from "./state-update-operation-feedback";
import { normalizeStateUpdateSearch, shouldSearchStateUpdateSubjects, STATE_UPDATE_SEARCH_DEBOUNCE_MS } from "./state-update-workflow-logic";

// Execute the renderer's actual diagnostic callback and read-effect dependencies.
// The read body is an observation spy: network/persistence are checked in OPFS separately.
const sourcePath = process.env.STATE_UPDATE_READ_HANDLER_SOURCE ?? `${process.cwd()}/src/renderers/workflows/state-update/StateUpdateWorkflow.tsx`;
const source = ts.createSourceFile("renderer.tsx", readFileSync(sourcePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map<string, ts.VariableStatement>();
const effects: ts.ExpressionStatement[] = [];
const visit = (node: ts.Node) => {
  if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, node);
  }
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
    const call = node.expression;
    if ((call.expression.getText(source) === "useEffect" && call.arguments[1]?.getText(source).includes("loadWorkflow")) ||
        (call.expression.getText(source) === "useLayoutEffect" && call.arguments[0]?.getText(source).includes("currentStateUpdateSyncRunIdRef"))) effects.push(node);
  }
  ts.forEachChild(node, visit);
};
visit(source);
const load = declarations.get("loadWorkflow")!.declarationList.declarations[0].initializer as ts.CallExpression;
const code = [
  ...[...declarations].filter(([name]) => name.startsWith("currentStateUpdateSyncRunId") || name === "stateUpdateRefreshKeyRef").map(([, node]) => node.getText(source)),
  declarations.get("recordVisibleError")!.getText(source),
  `const loadWorkflow = useCallback((...args: unknown[]) => onRead(...args), ${load.arguments[1].getText(source)});`,
  ...effects.map(node => node.getText(source)),
  "return {loadWorkflow, recordVisibleError};",
].join("\n");
const executable = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture() {
  const memo: { deps: unknown[]; value: unknown; cleanup?: () => void }[] = [];
  const refs: { current: unknown }[] = [];
  let hookIndex = 0, refIndex = 0;
  const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const context: Record<string, unknown> = Object.fromEntries((load.arguments[1] as ts.ArrayLiteralExpression).elements.map(node => [node.getText(source), {}]));
  delete context.recordVisibleError;
  const onRead = vi.fn(async () => undefined);
  const setVisibleErrorDiagnostics = vi.fn();
  const store = { recordStateUpdateVisibleErrorEvent: vi.fn(async () => undefined) };
  Object.assign(context, {
    useCallback: (callback: unknown, deps: unknown[]) => { const index = hookIndex++; if (!memo[index] || !same(memo[index].deps, deps)) memo[index] = { deps, value: callback }; return memo[index].value; },
    useRef: (initial: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }),
    useEffect: (effect: () => (() => void) | void, deps: unknown[]) => { const index = hookIndex++; if (!memo[index] || !same(memo[index].deps, deps)) { memo[index]?.cleanup?.(); memo[index] = { deps, value: null, cleanup: effect() ?? undefined }; } },
    useLayoutEffect: (effect: () => void) => effect(),
    onRead, setVisibleErrorDiagnostics, definitionCache: store, ownerKey: "synthetic-owner", selectedContractId: "contract-a",
    stateUpdateReconnectRefreshKey: 0, searchText: "", searchFieldId: undefined, searchReadId: 0,
    setItems: vi.fn(), setIsSearching: vi.fn(), shouldHandleStateUpdateRefresh, shouldSearchStateUpdateSubjects,
    normalizeStateUpdateSearch, STATE_UPDATE_SEARCH_DEBOUNCE_MS, createStateUpdateVisibleErrorDiagnostics,
  });
  const render = (syncRunId: string | null) => {
    hookIndex = 0; refIndex = 0;
    context.stateUpdateReconnectDiagnostics = { lastStateUpdateActivity: syncRunId ? { syncRunId } : null, lastStateUpdateSync: null };
    return new Function(...Object.keys(context), executable)(...Object.values(context)) as { loadWorkflow: typeof onRead; recordVisibleError(input: {error: unknown; operation: string}): void };
  };
  return { context, onRead, render, setVisibleErrorDiagnostics };
}
afterEach(() => vi.useRealTimers());
describe("STATE_UPDATE diagnostic observations are not read invalidations", () => {
  it("does not feed read completion telemetry back into initial/search effects, even with retained screens", async () => {
    vi.useFakeTimers();
    const screens = Array.from({length: 4}, () => fixture());
    screens.forEach(screen => screen.render(null));
    await vi.advanceTimersByTimeAsync(500);
    for (const screen of screens) expect(screen.onRead).toHaveBeenCalledTimes(2);
    for (const id of ["foreground-run", null, "foreground-run", null, "foreground-run"]) {
      screens.forEach(screen => screen.render(id));
      await vi.advanceTimersByTimeAsync(500);
    }
    for (const screen of screens) expect(screen.onRead).toHaveBeenCalledTimes(2);
  });
  it("still handles an explicit refresh, scope change and search, recording the current diagnostic run", async () => {
    vi.useFakeTimers(); const screen = fixture();
    screen.render(null); await vi.advanceTimersByTimeAsync(500); screen.onRead.mockClear();
    screen.context.stateUpdateReconnectRefreshKey = 1;
    let current = screen.render("foreground-run"); await vi.advanceTimersByTimeAsync(500);
    expect(screen.onRead).toHaveBeenCalledOnce(); expect(screen.onRead).toHaveBeenLastCalledWith({operation: "refresh"});
    screen.context.searchText = "synthetic"; current = screen.render("new-run");
    await vi.advanceTimersByTimeAsync(500);
    expect(screen.onRead).toHaveBeenCalledTimes(2);
    expect(screen.onRead).toHaveBeenLastCalledWith({operation: "search", page: 1, search: "synthetic", searchFieldId: undefined});
    current.recordVisibleError({ error: new Error("synthetic"), operation: "refresh" });
    expect(screen.setVisibleErrorDiagnostics).toHaveBeenLastCalledWith(expect.objectContaining({syncRunId: "new-run"}));
    screen.onRead.mockClear(); screen.context.selectedContractId = "contract-b"; screen.render("another-run");
    await vi.advanceTimersByTimeAsync(500); expect(screen.onRead).toHaveBeenCalledTimes(2);
  });
});
