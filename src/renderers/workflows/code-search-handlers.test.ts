// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createCodeReaderSession } from "../../lib/code-reader";

function actualHandler(kind: string, name: string, context: Record<string, unknown>) {
 const file = `${process.cwd()}/src/renderers/workflows/${kind}/${kind === "attendance" ? "AttendanceWorkflow" : "StateUpdateWorkflow"}.tsx`;
 const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
 let found: ts.Node | undefined;
 function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer && ts.isCallExpression(node.initializer)) found = node.initializer.arguments[0];
  ts.forEachChild(node, visit);
 }
 visit(source); if (!found) throw Error("Actual handler missing");
 const text = ts.isFunctionDeclaration(found) ? `${found.getText(source)};return ${name};` : `return ${found.getText(source)};`;
 const code = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 return new Function(...Object.keys(context), code)(...Object.values(context)) as (...args: any[]) => any;
}

describe.each(["attendance", "state-update"])("%s actual search input handler", kind => {
 it("one accepted read changes only the search, preserving textual data and never calling selection or a write", async () => {
  const context = Object.fromEntries(["setSearchText", "setSearchFieldId", "setSearchReadId", "setItems", "setIsSearching", "setSelectedItem", "setConflict", "setSuccessMessage", "setResolutionFeedback", "save", "selectPerson", "selectSubject", "confirmConflict"].map(key => [key, vi.fn()]));
  Object.assign(context, { requestSequenceRef: { current: 0 }, normalizeAttendanceSearch: (value: string) => value.trim(), normalizeStateUpdateSearch: (value: string) => value.trim() });
  const handler = actualHandler(kind, "changeSearchText", context); const stop = vi.fn();
  const session = createCodeReaderSession({ requestCamera: async () => ({ getTracks: () => [{ stop }] }), attach: async () => {}, detach() {}, createDecoder: async () => ({ decode: async () => ["00.123.450-K"], close() {} }), capture: () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }), schedule: vi.fn(), cancelScheduled() {}, onState() {}, onRead: value => handler(value, "stable-source-id") });
  await session.start(); await Promise.resolve();
  expect(context.setSearchText).toHaveBeenCalledExactlyOnceWith("00.123.450-K");
  expect(context.setSearchFieldId).toHaveBeenCalledExactlyOnceWith("stable-source-id");
  expect(context.setSearchReadId).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce();
  expect(context.setSelectedItem).toHaveBeenCalledExactlyOnceWith(null);
  for (const action of ["save", "selectPerson", "selectSubject", "confirmConflict"]) expect(context[action]).not.toHaveBeenCalled();
  handler("manual name"); expect(context.setSearchFieldId).toHaveBeenLastCalledWith(undefined);
 });
});

it("the actual Attendance read handler forwards the field to API/cache without calling writes", async () => {
 for (const online of [true, false]) {
  const context = { selectedContractId: "contract", ownerKey: "owner", token: "synthetic", isOnline: online, date: "2026-10-27", appView: { id: "view", config: { sourceEntityTypeId: "source", targetEntityTypeId: "target", statusFieldId: "status" } }, requestSequenceRef: { current: 1 }, beginSearchingRequest: vi.fn(() => 1), finishSearchingRequest: vi.fn(), setError: vi.fn(), setRefreshError: vi.fn(), setItems: vi.fn(), recordVisibleError: vi.fn(), clearVisibleError: vi.fn(), applyDayState: vi.fn(), refreshLocalDayState: vi.fn(), cacheAttendanceOnlineResponseInBackground: vi.fn(), stateUpdateItemToAttendanceItem: (item: unknown) => item,
   api: { getAttendanceWorkflow: vi.fn(async () => ({ items: [] })) }, definitionCache: { searchStateUpdateSubjects: vi.fn(async () => []) } };
  await actualHandler("attendance", "searchPeople", context)("TEST-PERSON-0001", "identifier-id");
  if (online) expect(context.api.getAttendanceWorkflow).toHaveBeenCalledExactlyOnceWith("synthetic", "contract", "view", { date: "2026-10-27", search: "TEST-PERSON-0001", searchFieldId: "identifier-id" });
  else expect(context.definitionCache.searchStateUpdateSubjects).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ searchFieldId: "identifier-id", search: "TEST-PERSON-0001", ownerKey: "owner", contractId: "contract", appViewId: "view" }));
 }
});
