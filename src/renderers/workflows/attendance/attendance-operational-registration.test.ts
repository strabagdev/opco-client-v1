// @ts-expect-error Node types are not part of the Expo application config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi, afterEach } from "vitest";
import { finalizeAttendanceDay } from "../../../lib/attendance-operational-day";
import { operationalCalendarKey, resolveOperationalDay, type OperationalCalendar } from "../../../lib/operational-calendar";
import { attendanceDailyCount } from "../../../lib/attendance-repetition";
import { captureTimeCommand } from "../../../lib/capture-time";
import { copyAttendanceEntry, attendanceAttemptKey } from "./attendance-edit-command";
import { attendanceEntryToStateUpdateEntry, attendanceEntryExtraValues } from "./attendance-workflow-logic";
import { attendanceStateFields } from "../../../lib/attendance-offline";
import { OpcoApiError } from "../../../lib/opco-api";
import { workflowWriteMetadata } from "../../../lib/workflow-write-contract";
import { attendanceRepeatConfirmationPresentation } from "./attendance-confirmation";

const source = ts.createSourceFile("AttendanceWorkflow.tsx", readFileSync(`${process.cwd()}/src/renderers/workflows/attendance/AttendanceWorkflow.tsx`, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name: string, context: Record<string, unknown>) {
  context={personReadPending:false,personReadRef:{current:null},setPersonReadPending:vi.fn(),authGeneration:0,...context,api:{isAuthSessionCurrent:(generation:number)=>generation===0,...(context.api as object??{})}};
  let declaration: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node; ts.forEachChild(node, visit); }
  visit(source);
  if (!declaration) throw Error(`Missing actual handler ${name}`);
  return new Function(...Object.keys(context), ts.transpileModule(`${declaration.getText(source)};return ${name}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(context));
}
const calendar: OperationalCalendar = { version: 1, timeZone: "America/Santiago", dayStart: "08:00", bands: [{ optionId: "a", start: "08:00", end: "20:00" }, { optionId: "b", start: "20:00", end: "08:00" }] };
function fixture(policy = "MULTIPLE_WITH_WARNING", online = false) {
  // The selected consultation is historical; selection/count authorization is for today's registration day.
  const c: Record<string, any> = { calendar, calendarKey: operationalCalendarKey(calendar), operationalContract: { version: 1, calendarKey: operationalCalendarKey(calendar) },
    date: "2026-10-01", registrationReadDateRef: { current: resolveOperationalDay(new Date(), calendar).date }, editingDateRef: { current: null },
    selectedItem: { person: { id: "person", displayName: "Synthetic" }, attendance: null }, editingTarget: null,
    confirmationBasis: "basis", confirmationBasisRef: { current: "basis" }, ownerKey: "owner", selectedContractId: "contract", token: "synthetic", isOnline: online, isSaving: false,
    saveInFlightRef: { current: false }, repeatCheckingRef: { current: false }, eventCapturedAtRef: { current: null }, repeatWarning: null,
    contextFields: [], contextValues: { context: "required-value" }, attendanceContextValidationErrors: () => [], setContextErrors: vi.fn(),
    resolutionScope: "scope", resolutionScopeRef: { current: "scope" }, resolutionMountedRef: { current: true }, draftRevisionRef: { current: 0 }, confirmationSequenceRef: { current: 0 },
    captureWorkflowWriteCommand: () => ({}), writeContract: null, writeContractRequiredRef: { current: false },
    captureTimeCommand, captureContract: { version: 1, fieldId: "capture", timeZone: calendar.timeZone },
    appView: { id: "view", config: { repetitionPolicy: policy, targetEntityTypeId: "events", captureTime: { fieldId: "capture", timeZone: calendar.timeZone } } },
    supportsObservation: false, observation: "", resolveOperationalDay, finalizeAttendanceDay, attendanceDailyCount,
    definitionCache: { getAttendanceDailyRecords: vi.fn(async () => []) }, api: { getAttendanceWorkflow: vi.fn(async (_t, _c, _v, query) => ({ appView: { id: "view" }, date: query.date, repetitionPolicy: policy, operationalDayContract: { calendarKey: operationalCalendarKey(calendar) }, items: [{ person: { id: "person" }, dailyRecordCount: 1 }] })) },
    setError: vi.fn(), setConflict: vi.fn(), setRepeatChecking: vi.fn(), setTemporalNotice: vi.fn(), setConfirmationError: vi.fn(), setResolutionFeedback: vi.fn(),
    saveEntry: vi.fn(async () => {}), clearPersonFlow: vi.fn(),
  };
  c.setRepeatWarning = vi.fn(value => { c.repeatWarning = value; });
  c.finalizeTemporalEntry = handler("finalizeTemporalEntry", c);
  c.cancelRepeatedRecord = handler("cancelRepeatedRecord", c);
  c.saveRepeatedStatus = handler("saveRepeatedStatus", c);
  return c;
}
afterEach(() => vi.useRealTimers());
function clock(value = "2026-11-23T03:15:00.123Z") { vi.useFakeTimers(); vi.setSystemTime(new Date(value)); }
async function save(c: Record<string, any>) { c.saveRepeatedStatus = handler("saveRepeatedStatus", c); await handler("saveStatus", c)({ optionId: "b", label: "B" }); if (c.repeatWarning) await handler("confirmRepeatedRecord", c)(); }

describe("Operational registration is independent of consultation (actual handlers)", () => {
  for (const policy of ["ONE_PER_DAY", "MULTIPLE", "MULTIPLE_WITH_WARNING"]) {
    it.each([true, false])(`${policy}: historical query/attentionDate never sets a new DATE, online=%s`, async online => {
      clock(); const c = fixture(policy, online);
      await save(c);
      expect(c.saveEntry).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ personRecordId: "person", statusOptionId: "b", contextValues: { context: "required-value" }, eventOccurredAt: "2026-11-23T03:15:00.123Z", operationalDay: { version: 1, calendarKey: c.calendarKey, mode: "AUTO" } }), "2026-11-22", null);
      expect(c.date).toBe("2026-10-01");
      for (const calls of [c.definitionCache.getAttendanceDailyRecords.mock.calls, c.api.getAttendanceWorkflow.mock.calls]) for (const args of calls) expect((args.length === 1 ? args[0] : args[3]).date).toBe("2026-11-22");
    });
    it(`${policy}: fails closed for a selection from the previous operational day`, async () => {
      clock(); const c = fixture(policy); vi.setSystemTime(new Date("2026-11-23T11:00:00.000Z")); await save(c);
      expect(c.saveEntry).not.toHaveBeenCalled(); expect(c.setRepeatWarning).not.toHaveBeenCalled(); expect(c.clearPersonFlow).toHaveBeenCalledOnce();
    });
  }
  it.each(["ONE_PER_DAY", "MULTIPLE_WITH_WARNING"])("%s selection reads today's records even if the search item came from history", async policy => {
    clock(); const c = fixture(policy, true);
    const historic = { person: { id: "person", displayName: "Synthetic" }, attendance: { recordId: "historical", updatedAt: "old", statusOptionId: "a" } };
    c.definitionCache.getAttendanceDailyRecords.mockResolvedValue([]);
    c.api.getAttendanceWorkflow.mockResolvedValue({ appView: { id: "view" }, date: "2026-11-22", repetitionPolicy: policy, items: [{ person: historic.person, attendance: null }], dailyRecords: [] });
    Object.assign(c, { setEditingTarget: vi.fn(), setPersonRecords: vi.fn(), setPersonRecordDate: vi.fn(), setSelectedItem: vi.fn(), setContextValues: vi.fn(), setObservation: vi.fn(), recordAttendanceLocalRead: vi.fn(), stateUpdateItemToAttendanceItem: vi.fn(), applyAttendanceResponse: vi.fn(), cacheAttendanceRemoteSnapshot: vi.fn(), attendanceEditContextValues: () => ({ context: "required-value" }) });
    await handler("selectRepeatedPerson", c)(historic);
    expect(c.definitionCache.getAttendanceDailyRecords).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-11-22" }));
    expect(c.api.getAttendanceWorkflow).toHaveBeenCalledWith("synthetic", "contract", "view", { date: "2026-11-22", personRecordId: "person" });
    expect(c.setSelectedItem).toHaveBeenLastCalledWith({ ...historic, attendance: null });
    expect(c.registrationReadDateRef.current).toBe("2026-11-22"); expect(c.setPersonRecordDate).toHaveBeenCalledWith("2026-11-22");
    expect(c.applyAttendanceResponse).toHaveBeenCalledWith(expect.anything(), { updateLatest: false, updateSummary: false });
  });
  it("ONE_PER_DAY keeps the unsynced current over its remote alias when selecting for registration", async () => {
    clock(); const c = fixture("ONE_PER_DAY", true);
    const person = { id: "person", displayName: "Synthetic" }, current = { person, attendance: { recordId: "server-current", statusOptionId: "b" } };
    c.definitionCache.getAttendanceDailyRecords.mockResolvedValue([{ localRecordId: "local-current", serverRecordId: "server-current", syncStatus: "pending_update" }]);
    c.api.getAttendanceWorkflow.mockResolvedValue({ appView: { id: "view" }, date: "2026-11-22", items: [{ person, attendance: { recordId: "server-current", statusOptionId: "a" } }] });
    Object.assign(c, { setEditingTarget: vi.fn(), setPersonRecords: vi.fn(), setPersonRecordDate: vi.fn(), setSelectedItem: vi.fn(), setContextValues: vi.fn(), setObservation: vi.fn(), recordAttendanceLocalRead: vi.fn(), stateUpdateItemToAttendanceItem: () => current, applyAttendanceResponse: vi.fn(), cacheAttendanceRemoteSnapshot: vi.fn(), attendanceEditContextValues: () => ({ context: "required-value" }) });
    await handler("selectRepeatedPerson", c)({ person, attendance: null });
    expect(c.setSelectedItem).toHaveBeenLastCalledWith(current); expect(c.setPersonRecords).toHaveBeenLastCalledWith([current]);
  });
  it("warning uses its final click across midnight, not its opening instant", async () => {
    clock("2026-11-23T02:59:59.000Z"); const c = fixture(); await c.saveRepeatedStatus({ optionId: "b" }); expect(c.eventCapturedAtRef.current).toBeNull();
    vi.setSystemTime(new Date("2026-11-23T03:00:00.001Z")); await handler("confirmRepeatedRecord", c)();
    expect(c.saveEntry).toHaveBeenCalledWith(expect.objectContaining({ eventOccurredAt: "2026-11-23T03:00:00.001Z" }), "2026-11-22", null);
  });
  it("an open warning crossing the operational start cannot reuse yesterday's count", async () => {
    clock("2026-11-23T10:59:59.000Z"); const c = fixture(); await c.saveRepeatedStatus({ optionId: "b" });
    vi.setSystemTime(new Date("2026-11-23T11:00:00.000Z")); await handler("confirmRepeatedRecord", c)();
    expect(c.saveEntry).not.toHaveBeenCalled(); expect(c.eventCapturedAtRef.current).toBeNull(); expect(c.clearPersonFlow).toHaveBeenCalledOnce();
    c.repeatWarning = null; c.registrationReadDateRef.current = "2026-11-23";
    await save(c); expect(c.saveEntry).toHaveBeenCalledWith(expect.objectContaining({ eventOccurredAt: "2026-11-23T11:00:00.000Z", statusOptionId: "b" }), "2026-11-23", expect.stringContaining("franja"));
  });
  it("a count response after the day boundary does not authorize a stale-day creation", async () => {
    clock("2026-11-23T10:59:59.000Z"); const c = fixture("MULTIPLE_WITH_WARNING", true);
    c.api.getAttendanceWorkflow.mockImplementation(async () => { vi.setSystemTime(new Date("2026-11-23T11:00:00.000Z")); return { appView: { id: "view" }, date: "2026-11-22", repetitionPolicy: "MULTIPLE_WITH_WARNING", operationalDayContract: { calendarKey: c.calendarKey }, items: [{ person: { id: "person" }, dailyRecordCount: 0 }] }; });
    await c.saveRepeatedStatus({ optionId: "b" }); expect(c.saveEntry).not.toHaveBeenCalled(); expect(c.setRepeatWarning).not.toHaveBeenCalled(); expect(c.eventCapturedAtRef.current).toBeNull();
  });
  it("cancel creates neither timestamp nor intent and cannot be confirmed late", async () => {
    clock(); const c = fixture(); await c.saveRepeatedStatus({ optionId: "b" }); const warning = c.repeatWarning;
    c.cancelRepeatedRecord(); await handler("confirmRepeatedRecord", { ...c, repeatWarning: warning })();
    expect(c.saveEntry).not.toHaveBeenCalled(); expect(c.eventCapturedAtRef.current).toBeNull();
  });
  it("ONE_PER_DAY explicit historical edit keeps its DATE and never invents a capture", async () => {
    clock(); const c = fixture("ONE_PER_DAY"); c.editingTarget = {}; c.editingDateRef.current = "2026-10-01";
    c.selectedItem.attendance = { recordId: "existing", updatedAt: "base" }; c.isOnline = true;
    await save(c); expect(c.saveEntry).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operationalDay: expect.objectContaining({ mode: "PRESERVE" }) }), "2026-10-01", null);
    expect(c.saveEntry.mock.calls[0][0]).not.toHaveProperty("eventOccurredAt");
  });
  it("unsent multiple edit keeps selected identity, original DATE/capture and acknowledgement", async () => {
    clock(); const c = fixture(); c.editingDateRef.current = "2026-10-01"; c.editingTarget = { targetLocalRecordId: "original-local", eventOccurredAt: "2026-10-01T19:00:00.000Z", repetitionAcknowledged: true };
    await save(c); expect(c.saveEntry).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ targetLocalRecordId: "original-local", eventOccurredAt: "2026-10-01T19:00:00.000Z", repetitionAcknowledged: true, operationalDay: expect.objectContaining({ mode: "PRESERVE" }) }), "2026-10-01");
  });
  it("unconfigured experiences keep their existing date and confirmation semantics", async () => {
    clock(); const c = fixture("MULTIPLE"); c.calendar = undefined; c.appView.config.captureTime = undefined; c.finalizeTemporalEntry = handler("finalizeTemporalEntry", c); c.saveRepeatedStatus = handler("saveRepeatedStatus", c);
    await c.saveRepeatedStatus({ optionId: "b" }); expect(c.saveEntry).toHaveBeenCalledExactlyOnceWith(expect.not.objectContaining({ operationalDay: expect.anything() })); expect(c.date).toBe("2026-10-01");
  });
  it.each([true, false])("durable ONE_PER_DAY never mistakes local updatedAt for a server base; cached=%s", async available => {
    clock(); const c = fixture("ONE_PER_DAY");
    Object.assign(c.appView.config, { statusFieldId: "state" });
    c.selectedItem.attendance = { recordId: "local-original", updatedAt: "2026-11-23T03:15:00.123Z" };
    Object.assign(c, { OpcoApiError, copyAttendanceEntry, attendanceAttemptKey, attendanceEntryToStateUpdateEntry, attendanceEntryExtraValues, attendanceStateFields, workflowWriteMetadata,
      onlineAttemptsRef: { current: new Map() }, setIsSaving: vi.fn(), setRefreshError: vi.fn(), setSuccessMessage: vi.fn(), clearVisibleError: vi.fn(), reportWriteFeedback: vi.fn(), recordVisibleError: vi.fn(), conflict: null,
      statuses: [{ optionId: "b", label: "B" }], refreshLocalDayState: vi.fn(), refreshRecordsSyncSummary: vi.fn(),
    });
    c.definitionCache.getCachedRecord = vi.fn(async () => available ? { localId: "local-original", serverId: null, values: { __opcoStateUpdateIntent: 1, expectedUpdatedAt: null } } : null);
    c.definitionCache.saveStateUpdateLocally = vi.fn(async () => ({ localRecordId: "local-original", clientRequestId: "original-key" }));
    const entry = finalizeAttendanceDay({ personRecordId: "person", statusOptionId: "b" }, { calendar, contract: c.operationalContract, date: c.date, mode: "AUTO", editing: false, instant: "2026-11-23T03:15:00.123Z" }).entry;
    await handler("saveEntry", c)(entry, "2026-11-22");
    if (available) expect(c.definitionCache.saveStateUpdateLocally).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-11-22", expectedUpdatedAt: null, preserveIdenticalConfirmedIntent: true }));
    else { expect(c.definitionCache.saveStateUpdateLocally).not.toHaveBeenCalled(); expect(c.setError).toHaveBeenCalledWith(expect.stringContaining("pendiente se conserva")); }
  });
  it("the existing single confirmation displays registration DATE, without manual-date actions", () => {
    const p = attendanceRepeatConfirmationPresentation({ localCount: 0, dateLabel: "22/11/2026", registration: { date: "2026-11-22", timeZone: "America/Santiago" } });
    expect(p.dateSummary).toContain("22/11/2026"); expect(p.confirmLabel).toBe("Confirmar registro"); expect(p.message).toContain("Sin conexión");
    expect(source.text).not.toContain("Registrar con fecha manual"); expect(source.text).toContain('label={calendar?"Fecha de consulta"');
  });
});
