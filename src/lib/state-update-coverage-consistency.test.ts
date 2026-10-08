// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { getLocalDatabase, __resetLocalDatabaseForTests } from "./local-db";
import { buildStateUpdateCoverageScope, type PreparedAppViewDefinition } from "./app-view-definitions-cache";
import { copyStateUpdateDiagnosticsWithCoverage, readStateUpdateCoverageCopySections, readVisibleStateUpdateCoverageCopySection } from "../state/state-update-coverage-copy";
import { formatStateUpdateDiagnosticsCopyText } from "../state/state-update-diagnostics-copy";
import { activateExperienceActivityScope, getExperienceActivitySnapshot, leaveExperienceActivityScope, reportExperienceActivity, resetExperienceActivityForTests } from "./experience-activity";
import { emptySyncTelemetry } from "./sync-telemetry";
const sqlite = vi.hoisted(() => ({ openDatabaseAsync: vi.fn() }));
vi.mock("expo-sqlite", () => sqlite);
function sqliteHarness(databasePath = ":memory:") {
  const worker = spawn("python3", ["-u", "-c", `
import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1], isolation_level=None)
c.row_factory=sqlite3.Row
for line in sys.stdin:
 try:
  q=json.loads(line); sql=q['sql']; args=q.get('args',[])
  if q['kind']=='exec':
   if sql.strip() in ('BEGIN','COMMIT','ROLLBACK'): c.execute(sql)
   else: c.executescript(sql)
   result=None
  else:
   cur=c.execute(sql,args)
   result=[dict(r) for r in cur.fetchall()] if q['kind']=='read' else {'changes':cur.rowcount}
  print(json.dumps({'result':result}))
 except Exception as e: print(json.dumps({'error':str(e),'sqliteCode':getattr(e,'sqlite_errorcode',None),'sqliteName':getattr(e,'sqlite_errorname',None)}))
`, databasePath]);
  let buffer = "";
  const queue: {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }[] = [];
  worker.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      const reply = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const task = queue.shift()!;
      if (reply.error) task.reject(Object.assign(new Error(reply.error), {
        sqliteCode: reply.sqliteCode,
        sqliteName: reply.sqliteName
      }));else task.resolve(reply.result);
    }
  });
  const query = (kind: string, sql: string, args: unknown[] = []) => new Promise<any>((resolve, reject) => {
    queue.push({
      resolve,
      reject
    });
    worker.stdin.write(JSON.stringify({
      kind,
      sql,
      args
    }) + "\n");
  });
  const db = {
    execAsync: (sql: string) => query("exec", sql),
    getAllAsync: (sql: string, ...args: unknown[]) => query("read", sql, args),
    getFirstAsync: async (sql: string, ...args: unknown[]) => (await query("read", sql, args))[0] ?? null,
    runAsync: vi.fn((sql: string, ...args: unknown[]) => query("write", sql, args)),
    withTransactionAsync: async (task: () => Promise<void>) => {
      await query("exec", "BEGIN");
      try {
        await task();
        await query("exec", "COMMIT");
      } catch (error) {
        await query("exec", "ROLLBACK");
        throw error;
      }
    },
    closeAsync: async () => {
      worker.kill();
    }
  };
  return {
    db,
    stop: () => worker.kill()
  };
}


const context = { ownerKey: "private-owner", contractId: "private-contract", appViewId: "private-view", date: "2026-10-07" };
const view = { id: context.appViewId, name: "Private display name", slug: "private-slug", icon: null, sortOrder: 0, type: "WORKFLOW" as const, config: { workflowKey: "state-update" as const } };
const definition: Extract<PreparedAppViewDefinition, { kind: "state-update" }> = {
  kind: "state-update", appView: view, dateFieldId: "private-date-field", historyMode: "append", uniqueness: "subject",
  sourceEntityTypeId: "private-source", targetEntityTypeId: "private-target", subjectFieldId: "private-subject-field", stateFields: [], extraFields: [],
};
const scope = buildStateUpdateCoverageScope(context, definition);
let harness: ReturnType<typeof sqliteHarness>;
let store: ReturnType<typeof getLocalDatabase>;
beforeEach(async () => {
  resetExperienceActivityForTests();
  __resetLocalDatabaseForTests(); harness = sqliteHarness(); sqlite.openDatabaseAsync.mockResolvedValue(harness.db);
  store = getLocalDatabase(); await store.getSelectedContractId();
  await store.upsertAppViews(context.ownerKey, context.contractId, [view], "2026-10-07T12:00:00Z");
  await store.upsertAppViewDefinition({ ...context, appViewType: "WORKFLOW", definition, status: "ready", workflowKey: "state-update", lastPreparedAt: "2026-10-07T12:00:00Z" });
});
afterEach(() => { harness.stop(); __resetLocalDatabaseForTests(); resetExperienceActivityForTests(); });
async function mark(verified: boolean) {
  await store.markStateUpdateSnapshotCoverage({ ...scope, pagination: { page: 1, pageSize: 20, total: 2, hasMore: false }, snapshotResult: { contentVerified: verified, persistedRemoteEventCount: 2, staleSyncedRemoved: 0 } });
}
async function copy() {
  return formatStateUpdateDiagnosticsCopyText(await readStateUpdateCoverageCopySections({ store, ...context }));
}
it("reports per-subject current proof separately from partial latest without record values", async () => {
  await store.reconcileRemoteRecordsSnapshot({ ownerKey: scope.ownerKey, contractId: scope.contractId, entityTypeId: definition.sourceEntityTypeId,
    records: ["private-versioned-subject", "private-empty-subject"].map(id => ({ id, displayName: "Synthetic", updatedAt: "2026-10-07T12:00:00Z", values: {} })) });
  await store.upsertStateUpdateSnapshot({ ...scope, complete: false, items: [{ subject: { id: "private-versioned-subject", displayName: "Synthetic" }, current: {
    recordId: "private-event", updatedAt: "2026-10-07T12:00:00Z", stateValues: [{ fieldId: definition.dateFieldId!, value: "2026-10-07", label: "2026-10-07", optionId: null }],
  } }], latest: [] });
  await store.setStateUpdateCurrentCoverage({ ...scope, sourceEntityTypeId: definition.sourceEntityTypeId, coverage: {
    status: "complete", sourceComplete: true, totalSubjects: 2,
    subjects: { "private-versioned-subject": { status: "verified", remoteRecordId: "private-event" }, "private-empty-subject": { status: "verified", remoteRecordId: null } },
    requestCount: 2, durationMs: 42, refreshedAt: "2026-10-07T12:00:00Z",
  } });
  await store.markStateUpdateSnapshotCoverage({ ...scope, pagination: { page: 1, pageSize: 20, total: 217, hasMore: true } });
  const sections = await readStateUpdateCoverageCopySections({ store, ownerKey: context.ownerKey, contractId: context.contractId, date: context.date });
  const text = formatStateUpdateDiagnosticsCopyText(sections);
  for (const expected of ["status: partial", "currentCompleteness: complete", "currentSourceComplete: true", "currentVerifiedSubjects: 2", "currentSubjectsWithoutVersion: 1", "currentRequestCount: 2", "currentDurationMs: 42"]) expect(text).toContain(expected);
  for (const value of ["private-versioned-subject", "private-empty-subject", "private-event"]) expect(text).not.toContain(value);
});

describe("Home/workflow coverage and local diagnostic metadata", () => {
  it("wires both real consumers to the shared configuration scope", () => {
    const home = readFileSync("app/(app)/index.tsx", "utf8");
    const workflow = readFileSync("src/renderers/workflows/state-update/StateUpdateWorkflow.tsx", "utf8");
    expect(home).toMatch(/getStateUpdateSnapshotCoverage\(buildStateUpdateCoverageScope\(/);
    expect(home).toMatch(/}, definition\.definition\)\)/);
    expect(workflow).toMatch(/const scope = buildStateUpdateCoverageScope\(/);
    expect(workflow).toContain("getStateUpdateSnapshotCoverage(scope)");
  });
  it("shares scope configuration and applies the same complete/partial proof", async () => {
    expect(scope).toMatchObject({ dateFieldId: definition.dateFieldId, historyMode: "append", uniqueness: "subject", targetEntityTypeId: definition.targetEntityTypeId });
    await mark(true);
    expect((await store.getStateUpdateSnapshotCoverage(buildStateUpdateCoverageScope(context, definition)))?.status).toBe("complete");
    await mark(false);
    expect((await store.getStateUpdateSnapshotCoverage(buildStateUpdateCoverageScope(context, definition)))?.status).toBe("partial");
  });
  it("downgrades a legacy complete marker without writing or deleting it", async () => {
    await mark(true);
    await harness.db.runAsync("UPDATE app_metadata SET value = json_remove(value, '$.contentVerified') WHERE key LIKE 'state_update_snapshot_coverage:%'");
    expect((await store.getStateUpdateSnapshotCoverage(scope))?.status).toBe("partial");
    expect(await copy()).toContain("contentVerified: null");
    expect(await copy()).toContain("status: partial");
    const row = await harness.db.getFirstAsync("SELECT value FROM app_metadata WHERE key LIKE 'state_update_snapshot_coverage:%'");
    expect(JSON.parse(row.value).status).toBe("complete");
  });
  it("copies present marker metadata, fingerprints and separate unverified current completeness", async () => {
    await mark(true);
    harness.db.runAsync.mockClear();
    const text = await copy();
    expect(harness.db.runAsync).not.toHaveBeenCalled();
    for (const expected of ["queriedDate: 2026-10-07", "markerPresent: true", "status: complete", "contentVerified: true", "downloadedThroughPage: 1", "pageSize: 20", "total: 2", "lastSuccessfulRefreshAt:", "currentCompleteness: not_certified", "subjectsAvailability: unverified", "appViewFingerprint: fp_"]) expect(text).toContain(expected);
    expect(text).not.toContain("private-"); expect(text).not.toContain(view.name);
  });
  it("copies absent marker metadata without certifying subjects/current", async () => {
    const text = await copy();
    expect(text).toContain("markerPresent: false"); expect(text).toContain("status: absent");
    expect(text).toContain("total: null"); expect(text).toContain("contentVerified: null");
    expect(text).toContain("currentCompleteness: not_certified");
  });
  it("isolates queried dates and preserves no-date and Attendance policies", async () => {
    await mark(true);
    const next = await readStateUpdateCoverageCopySections({ store, ...context, date: "2026-10-08" });
    expect(formatStateUpdateDiagnosticsCopyText(next)).toContain("markerPresent: false");
    const noDate = buildStateUpdateCoverageScope(context, { ...definition, dateFieldId: undefined, historyMode: "update-current", uniqueness: "subject-date" });
    expect(noDate.date).toBeUndefined();
    const cachedViews = vi.spyOn(store, "getAppViews").mockResolvedValue({ views: [{ ...view, config: { workflowKey: "attendance" } }], syncedAt: "synthetic" });
    const read = vi.spyOn(store, "getStateUpdateSnapshotCoverage"); await copy(); expect(read).not.toHaveBeenCalled(); cachedViews.mockRestore();
  });
  it("reports prior subject refresh separately from latest proof and current completeness", async () => {
    vi.spyOn(store, "getSyncTelemetry").mockResolvedValue({ ...emptySyncTelemetry({ ownerKey: context.ownerKey, contractId: context.contractId, entityTypeId: definition.sourceEntityTypeId }), lastFullRefreshCompletedAt: "2026-10-06T10:00:00Z" });
    const text = await copy(); expect(text).toContain("subjectsAvailability: previous_full_refresh");
    expect(text).toContain("status: absent"); expect(text).toContain("currentCompleteness: not_certified");
  });
});


function reportVisible(date: string) {
  const scopeKey = `${context.ownerKey}\u0000${context.contractId}\u0000${context.appViewId}`;
  activateExperienceActivityScope({ appViewId: view.id, appViewTitle: view.name, appViewType: "WORKFLOW", scopeKey });
  reportExperienceActivity({ scopeKey, activeCount: 0, errorCode: null, result: "success", stateUpdateCoverage: {
    scope: buildStateUpdateCoverageScope({ ...context, date }, definition), sourceEntityTypeId: definition.sourceEntityTypeId,
  } });
  return scopeKey;
}
async function copyButton() {
  const clipboard = vi.fn(async (_text: string) => undefined);
  await copyStateUpdateDiagnosticsWithCoverage({ copyText: "[Existing diagnostic]", copyToClipboard: clipboard, store,
    ownerKey: context.ownerKey, contractId: context.contractId, visibleAppViewId: view.id, homeDate: context.date });
  return clipboard.mock.calls[0][0];
}
describe("copy button with effective visible workflow context", () => {
  it("copies different Home and selected dates with each correct marker, without writes or personal values", async () => {
    await store.markStateUpdateSnapshotCoverage({ ...scope, refreshedAt: "2026-10-07T12:00:00Z", pagination: { page: 1, pageSize: 20, total: 2, hasMore: false }, snapshotResult: { contentVerified: true, persistedRemoteEventCount: 2, staleSyncedRemoved: 0 } });
    await store.markStateUpdateSnapshotCoverage({ ...scope, date: "2026-10-04", refreshedAt: "2026-10-04T12:00:00Z", pagination: { page: 1, pageSize: 5, total: 9, hasMore: true }, snapshotResult: { contentVerified: false, persistedRemoteEventCount: 5, staleSyncedRemoved: 0 } });
    reportVisible("2026-10-04");
    harness.db.runAsync.mockClear();
    const text = await copyButton();
    const home = text.split("[STATE_UPDATE home_local_today latest coverage")[1].split("[STATE_UPDATE visible_workflow")[0];
    const visible = text.split("[STATE_UPDATE visible_workflow latest coverage")[1];
    expect(home).toContain("queriedDate: 2026-10-07"); expect(home).toContain("status: complete");
    expect(home).toContain("pageSize: 20"); expect(home).toContain("total: 2"); expect(home).toContain("lastSuccessfulRefreshAt: 2026-10-07T12:00:00Z");
    expect(visible).toContain("queriedDate: 2026-10-04"); expect(visible).toContain("status: partial");
    expect(visible).toContain("pageSize: 5"); expect(visible).toContain("total: 9"); expect(visible).toContain("lastSuccessfulRefreshAt: 2026-10-04T12:00:00Z");
    expect(visible).toContain("currentCompleteness: not_certified"); expect(text).toContain("homeDateSource: local_today");
    expect(text).toContain("visibleDateSource: workflow_context; never_clock");
    expect(text).not.toContain("private-"); expect(text).not.toContain(view.name);
    expect(harness.db.runAsync).not.toHaveBeenCalled();
  });
  it("does not substitute the Home marker when the selected date has no marker", async () => {
    await mark(true); reportVisible("2026-10-04");
    const visible = (await copyButton()).split("[STATE_UPDATE visible_workflow latest coverage")[1];
    expect(visible).toContain("queriedDate: 2026-10-04"); expect(visible).toContain("status: absent"); expect(visible).toContain("markerPresent: false");
  });
  it("updates the visible date in the existing activity context and clears it on departure", async () => {
    const key = reportVisible("2026-10-04"); reportVisible("2026-10-05");
    expect(getExperienceActivitySnapshot().stateUpdateCoverage?.scope.date).toBe("2026-10-05");
    leaveExperienceActivityScope("another-scope"); expect(getExperienceActivitySnapshot().stateUpdateCoverage?.scope.date).toBe("2026-10-05");
    leaveExperienceActivityScope(key);
    const text = await copyButton(); expect(text).toContain("availability: unavailable");
    expect(text).toContain("home marker does not explain visible workflow warning");
    expect(text).not.toContain("[STATE_UPDATE visible_workflow latest coverage");
  });
  it.each(["owner", "contract", "view", "scopeKey", "non-workflow"])("rejects stale %s context before reading its marker", async (mismatch) => {
    reportVisible("2026-10-04");
    const original = getExperienceActivitySnapshot();
    const experience = { ...original, stateUpdateCoverage: { ...original.stateUpdateCoverage!, scope: { ...original.stateUpdateCoverage!.scope } } };
    if (mismatch === "owner") experience.stateUpdateCoverage.scope.ownerKey = "another-owner";
    if (mismatch === "contract") experience.stateUpdateCoverage.scope.contractId = "another-contract";
    if (mismatch === "view") experience.stateUpdateCoverage.scope.appViewId = "another-view";
    if (mismatch === "scopeKey") experience.scopeKey = "previous-scope";
    if (mismatch === "non-workflow") experience.appViewType = "RECORDS";
    const read = vi.spyOn(store, "getStateUpdateSnapshotCoverage");
    const section = await readVisibleStateUpdateCoverageCopySection({ store, ownerKey: context.ownerKey, contractId: context.contractId, visibleAppViewId: view.id, experience });
    expect(formatStateUpdateDiagnosticsCopyText([section])).toContain("availability: unavailable"); expect(read).not.toHaveBeenCalled();
  });
  it("ignores late reports and clears STATE_UPDATE context on a different AppView", () => {
    const key = reportVisible("2026-10-04");
    activateExperienceActivityScope({ appViewId: "other-view", appViewTitle: "Other", appViewType: "RECORDS", scopeKey: "other" });
    reportExperienceActivity({ scopeKey: key, activeCount: 0, errorCode: null, result: "success", stateUpdateCoverage: { scope, sourceEntityTypeId: definition.sourceEntityTypeId } });
    expect(getExperienceActivitySnapshot().stateUpdateCoverage).toBeUndefined();
  });
  it("wires the actual copy button, visible route and workflow state to the tested copy path", () => {
    const panel = readFileSync("src/state/session.tsx", "utf8");
    const shell = readFileSync("app/(app)/_layout.tsx", "utf8");
    const workflow = readFileSync("src/renderers/workflows/state-update/StateUpdateWorkflow.tsx", "utf8");
    const reporter = readFileSync("src/renderers/use-experience-activity.ts", "utf8");
    expect(panel).toContain("onPress={handleCopyStateUpdate}");
    expect(panel).toMatch(/await copyStateUpdateDiagnosticsWithCoverage\(\{[\s\S]*?copyToClipboard: copyTextToClipboard/);
    expect(shell).toContain(".test(pathname) ? visibleAppViewId : null}");
    const visibleRoutePattern = shell.match(/visibleAppViewId=\{\/(.+)\/\.test\(pathname\)/)?.[1];
    expect(visibleRoutePattern).toBeDefined();
    const visibleRoute = new RegExp(visibleRoutePattern!);
    expect(visibleRoute.test("/view/private-view")).toBe(true);
    expect(visibleRoute.test("/view/private-view/record/new")).toBe(false);
    expect(visibleRoute.test("/")).toBe(false);
    expect(workflow).toMatch(/scope: buildStateUpdateCoverageScope\(\{[\s\S]*?date,/);
    expect(workflow).toMatch(/useExperienceActivityReporter\(appView, \{\s*stateUpdateCoverage,/);
    expect(reporter).toContain("reportExperienceActivity({ activeCount, errorCode, result, scopeKey, stateUpdateCoverage })");
  });
});
