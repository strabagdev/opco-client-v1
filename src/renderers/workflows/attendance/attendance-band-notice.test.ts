// @ts-expect-error Node types are not part of the Expo application config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { finalizeAttendanceDay, savedAttendanceBandNotice } from "../../../lib/attendance-operational-day";
import { operationalCalendarKey, resolveOperationalDay } from "../../../lib/operational-calendar";
import { attendanceDailyCount } from "../../../lib/attendance-repetition";
import { captureTimeCommand } from "../../../lib/capture-time";
import { copyAttendanceEntry, attendanceAttemptKey } from "./attendance-edit-command";
import { attendanceEntryToStateUpdateEntry, attendanceEntryExtraValues, normalizeAttendanceSearch } from "./attendance-workflow-logic";
import { attendanceStateFields } from "../../../lib/attendance-offline";
import { OpcoApiError } from "../../../lib/opco-api";
import { workflowWriteMetadata } from "../../../lib/workflow-write-contract";

const source = ts.createSourceFile("AttendanceWorkflow.tsx", readFileSync(`${process.cwd()}/src/renderers/workflows/attendance/AttendanceWorkflow.tsx`, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actual(name: string, context: Record<string, unknown>) {
  let body: string | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) body = `${node.getText(source)};return ${name};`;
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) body = `return ${node.initializer.arguments[0].getText(source)};`;
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!body) throw Error(`Missing actual handler ${name}`);
  return new Function(...Object.keys(context), ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(context));
}
const instant = "2026-11-24T09:10:11.092Z";
const calendar = { version: 1 as const, timeZone: "America/Santiago", dayStart: "08:00", bands: [{ optionId: "a", start: "08:00", end: "20:00" }, { optionId: "b", start: "20:00", end: "08:00" }] };
const mismatch = finalizeAttendanceDay({ statusOptionId: "a" }, { calendar, contract: { version: 1, calendarKey: operationalCalendarKey(calendar) }, date: "2026-11-23", mode: "AUTO", editing: false, instant }).notice!;
function fixture(online = false) {
  vi.useFakeTimers(); vi.setSystemTime(new Date(instant));
  const c: Record<string, any> = {
    authGeneration:0, api:{isAuthSessionCurrent:(generation:number)=>generation===0},
    calendar, operationalContract: { version: 1, calendarKey: operationalCalendarKey(calendar) },
    date: "2026-11-23", registrationReadDateRef: { current: "2026-11-23" }, editingDateRef: { current: null }, eventCapturedAtRef: { current: null },
    selectedItem: { person: { id: "person", displayName: "Synthetic" }, attendance: null }, editingTarget: null,
    ownerKey: "owner", selectedContractId: "contract", token: "synthetic", isOnline: online, isSaving: false,
    confirmationBasis: "basis", confirmationBasisRef: { current: "basis" }, resolutionScope: "scope", resolutionScopeRef: { current: "scope" }, resolutionMountedRef: { current: true },
    draftRevisionRef: { current: 0 }, confirmationSequenceRef: { current: 0 }, saveInFlightRef: { current: false }, repeatCheckingRef: { current: false }, onlineAttemptsRef: { current: new Map() },
    repeatWarning: null, contextFields: [], contextValues: {}, attendanceContextValidationErrors: () => [], observation: "", supportsObservation: false, conflict: null,
    writeContract: null, writeContractRequiredRef: { current: false }, captureWorkflowWriteCommand: () => ({}), captureTimeCommand,
    appView: { id: "view", name: "Synthetic", config: { operationalCalendar: calendar, captureTime: { fieldId: "capture", timeZone: calendar.timeZone }, repetitionPolicy: "MULTIPLE_WITH_WARNING", statusFieldId: "state", targetEntityTypeId: "target" } },
    captureContract: { version: 1, fieldId: "capture", timeZone: calendar.timeZone },
    statuses: [{ optionId: "a", label: "A", isDefaultCheckIn: true }, { optionId: "b", label: "B", isDefaultCheckIn: false }],
    resolveOperationalDay, finalizeAttendanceDay, savedAttendanceBandNotice, attendanceDailyCount, copyAttendanceEntry, attendanceAttemptKey, attendanceEntryToStateUpdateEntry, attendanceEntryExtraValues, normalizeAttendanceSearch, attendanceStateFields, workflowWriteMetadata, OpcoApiError,
    definitionCache: { getAttendanceDailyRecords: vi.fn(async () => []), saveStateUpdateLocally: vi.fn(async () => ({ localRecordId: "local", clientRequestId: "request" })), getStateUpdateResolutionOutcome: vi.fn(async () => "confirmed") },
    syncPendingRecords: vi.fn(async () => {}), refreshLocalDayState: vi.fn(async () => {}), refreshRecordsSyncSummary: vi.fn(async () => {}), clearVisibleError: vi.fn(), recordVisibleError: vi.fn(), reportWriteFeedback: vi.fn(),
    setError: vi.fn(), setConflict: vi.fn(), setRepeatChecking: vi.fn(), setContextErrors: vi.fn(), setIsSaving: vi.fn(), setRefreshError: vi.fn(), setSuccessMessage: vi.fn(),
  };
  for (const name of ["setPersonRecords", "setPersonRecordDate", "setConfirmationError", "setResolutionFeedback", "setSearchText", "setSearchFieldId", "setSearchReadId", "setItems", "setIsSearching", "setObservation", "setObservationExpanded", "setContextValues"]) c[name] = vi.fn();
  c.notice = mismatch; c.setTemporalNotice = vi.fn(value => { c.notice = value; });
  c.setSelectedItem = vi.fn(value => { c.selectedItem = value; });
  c.setEditingTarget = vi.fn(value => { c.editingTarget = value; });
  c.setRepeatWarning = vi.fn(value => { c.repeatWarning = value; });
  c.requestSequenceRef = { current: 0 };
  c.finalizeTemporalEntry = (...args: unknown[]) => actual("finalizeTemporalEntry", c)(...args);
  c.clearPersonFlow = () => actual("clearPersonFlow", c)();
  c.saveEntry = vi.fn(async () => {});
  return c;
}
afterEach(() => vi.useRealTimers());

describe("Band notice belongs to one Attendance confirmation", () => {
  it.each(["clearPersonFlow", "changeSearchText", "handleContextChange"])("%s retires the previous notice", name => {
    const c = fixture();
    if (name === "handleContextChange") { c.ownerKey = null; actual(name, c)("context", null); }
    else if (name === "changeSearchText") actual(name, c)("next person");
    else actual(name, c)();
    expect(c.notice).toBeNull(); expect(c.saveEntry).not.toHaveBeenCalled();
  });
  it.each(["selectRepeatedPerson", "editRepeatedRecord"])("%s clears the notice before its exact-record read finishes", async name => {
    const c = fixture(); let done!: (value: unknown) => void;
    const pending = new Promise(resolve => { done = resolve; });
    c.definitionCache.getAttendanceDailyRecords.mockReturnValue(pending); c.definitionCache.getCachedRecord = vi.fn(() => pending);
    const request = actual(name, c)({ person: { id: "other", displayName: "Synthetic" }, attendance: { recordId: "exact", updatedAt: instant } });
    expect(c.notice).toBeNull(); c.resolutionScopeRef.current = "changed"; done(name === "selectRepeatedPerson" ? [] : null); await request;
    expect(c.saveEntry).not.toHaveBeenCalled();
  });
  it.each(["a", "b"])("recalculates %s only at the definitive warning click at 06:10", async optionId => {
    const c = fixture(); await actual("saveRepeatedStatus", c)({ optionId, label: optionId.toUpperCase() });
    expect(c.notice).toBeNull(); expect(c.saveEntry).not.toHaveBeenCalled(); expect(c.eventCapturedAtRef.current).toBeNull();
    await actual("confirmRepeatedRecord", c)();
    expect(c.saveEntry).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ statusOptionId: optionId, eventOccurredAt: instant, operationalDay: expect.objectContaining({ mode: "AUTO" }) }), "2026-11-23", optionId === "a" ? mismatch : null);
  });
  it("cancel clears the notice and preserves the absence of a new intention", async () => {
    const c = fixture(); await actual("saveRepeatedStatus", c)({ optionId: "b", label: "B" });
    c.setTemporalNotice(mismatch); const previous = c.repeatWarning; actual("cancelRepeatedRecord", c)();
    expect(c.notice).toBeNull(); expect(c.repeatWarning).toBeNull(); expect(c.eventCapturedAtRef.current).toBeNull();
    await actual("confirmRepeatedRecord", { ...c, repeatWarning: previous })(); expect(c.saveEntry).not.toHaveBeenCalled();
  });
  it.each([false, true])("labels the saved result separately from its band warning, online=%s", async online => {
    const c = fixture(online); const entry = c.finalizeTemporalEntry({ personRecordId: "person", statusOptionId: "a", repetitionPolicy: "MULTIPLE_WITH_WARNING", repetitionAcknowledged: true, contextValues: {} }, false);
    await actual("saveEntry", c)(entry.entry, entry.date, entry.notice);
    expect(c.notice).toBe(savedAttendanceBandNotice(mismatch, online ? "server-confirmed" : "local-saved"));
    expect(c.reportWriteFeedback).toHaveBeenCalledWith(expect.objectContaining({ kind: online ? "server-confirmed" : "local-saved" }));
    if (!online) { expect(c.notice).not.toContain("confirmado por Opco"); expect(c.syncPendingRecords).not.toHaveBeenCalled(); }
  });
  it("an online attempt without a confirmed resolution still reports only the local commit", async () => {
    const c = fixture(true); c.definitionCache.getStateUpdateResolutionOutcome.mockResolvedValue("pending");
    const entry = c.finalizeTemporalEntry({ personRecordId: "person", statusOptionId: "a", repetitionPolicy: "MULTIPLE_WITH_WARNING", contextValues: {} }, false);
    await actual("saveEntry", c)(entry.entry, entry.date, entry.notice);
    expect(c.notice).toBe(savedAttendanceBandNotice(mismatch, "local-saved"));
    expect(c.reportWriteFeedback).toHaveBeenCalledWith(expect.objectContaining({ kind: "local-saved" }));
    expect(JSON.stringify(c.definitionCache.saveStateUpdateLocally.mock.calls)).not.toContain("franja");
  });
  it("does not claim a saved result before the local commit or when it rejects", async () => {
    const c = fixture(); let reject!: (error: Error) => void;
    c.definitionCache.saveStateUpdateLocally.mockReturnValue(new Promise((_resolve, no) => { reject = no; }));
    const entry = c.finalizeTemporalEntry({ personRecordId: "person", statusOptionId: "a", repetitionPolicy: "MULTIPLE_WITH_WARNING", contextValues: {} }, false);
    const save = actual("saveEntry", c)(entry.entry, entry.date, entry.notice);
    expect(c.notice).toBe(mismatch); expect(c.reportWriteFeedback).not.toHaveBeenCalled(); reject(Error("Injected storage failure")); await save;
    expect(c.notice).toBe(mismatch); expect(c.reportWriteFeedback).not.toHaveBeenCalled(); expect(c.selectedItem?.person.id).toBe("person");
  });
  it("an old result cannot restore its warning after another draft starts", async () => {
    const c = fixture(true); let finish!: () => void;
    c.syncPendingRecords.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const entry = c.finalizeTemporalEntry({ personRecordId: "person", statusOptionId: "a", repetitionPolicy: "MULTIPLE_WITH_WARNING", contextValues: {} }, false);
    const save = actual("saveEntry", c)(entry.entry, entry.date, entry.notice);
    await vi.waitFor(() => expect(c.syncPendingRecords).toHaveBeenCalledOnce());
    actual("changeSearchText", c)("next"); expect(c.notice).toBeNull(); finish(); await save;
    expect(c.notice).toBeNull(); expect(c.reportWriteFeedback).not.toHaveBeenCalled();
  });
});
