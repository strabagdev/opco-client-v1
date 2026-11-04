import { describe, expect, it } from "vitest";
import type { AttendanceContextField, AttendanceItem, AttendanceWorkflowConfig } from "../../../lib/opco-api";
import { stateUpdateItemToAttendanceItem } from "../../../lib/attendance-offline";
import { canonicalAttendanceContextValue, attendanceResponseToStateUpdateItems, attendanceContextFieldsFromPreparedDefinition, attendanceContextValidationErrors, attendanceEntryExtraValues, attendanceEntryToStateUpdateEntry, sanitizeAttendanceContextSelections } from "./attendance-workflow-logic";
import { attendanceCommandKey, attendanceEditContextValues } from "./attendance-edit-command";
const fields: AttendanceContextField[] = [
 { id: "choice", name: "Choice", type: "SELECT", required: true, options: [{ optionId: "one", value: "canonical_one", label: "One" }] },
 { id: "related", name: "Related context", type: "RELATION", required: true, config: { relation: { targetEntityTypeId: "catalog", relationKind: "ONE" } } },
];
const config: AttendanceWorkflowConfig = { workflowKey: "attendance", sourceEntityTypeId: "subjects", targetEntityTypeId: "events", personFieldId: "person", dateFieldId: "date", statusFieldId: "status", contextFieldIds: ["choice", "related"] };
describe("Attendance SELECT plus simple RELATION context", () => {
 it("keeps stable relation IDs not present in the current catalog page and SELECT option identity", () => {
  expect(sanitizeAttendanceContextSelections(fields, { choice: "one", related: "record-outside-page" })).toEqual({ choice: "one", related: "record-outside-page" });
  expect(attendanceContextValidationErrors(fields, { choice: "one", related: null })).toEqual([{ fieldId: "related", message: "Related context es obligatorio." }]);
  expect(attendanceContextValidationErrors(fields, { choice: "one", related: "record-outside-page" })).toEqual([]);
 });
 it("sends relation ID and canonical SELECT, preserving state and base for every subject", () => {
  for (const personRecordId of ["subject-one", "subject-two"]) {
   const result = attendanceEntryToStateUpdateEntry({ personRecordId, statusOptionId: "status-b", contextValues: { choice: "one", related: "catalog-one" }, overwrite: true, expectedUpdatedAt: "2026-11-03T10:00:00.000Z" }, config, fields);
   expect(result).toEqual({ subjectRecordId: personRecordId, stateValues: [{ fieldId: "status", optionId: "status-b" }], extraValues: { choice: "canonical_one", related: "catalog-one" }, overwrite: true, expectedUpdatedAt: "2026-11-03T10:00:00.000Z" });
  }
 });
 it("editing hydrates the actual stored relation, never the remembered default; new rows inherit it", () => {
  const item = { person: { id: "person", displayName: "Synthetic" }, attendance: { recordId: "event", observation: null, statusOptionId: "status-a", statusLabel: "A", updatedAt: "2026-11-03T10:00:00.000Z", contextValues: { related: { id: "actual-record", displayName: "Stored label" }, choice: { optionId: "one", label: "One" } } } } satisfies AttendanceItem;
  const remembered = { related: "next-record", choice: "one" };
  expect(attendanceEditContextValues(fields, item, remembered)).toEqual({ related: "actual-record", choice: "one" });
  expect(attendanceEditContextValues(fields, { ...item, attendance: null }, remembered)).toEqual(remembered);
 });
 it("prepared metadata and typed offline current retain relation ID and label", () => {
  expect(attendanceContextFieldsFromPreparedDefinition([{ id: "related", key: "related_key", name: "Related context", required: true, type: "RELATION", config: { relation: { targetEntityTypeId: "catalog", relationKind: "ONE" } } }], ["related"])).toEqual([fields[1] && { ...fields[1], key: "related_key" }]);
  const item = stateUpdateItemToAttendanceItem({ subject: { id: "person", displayName: "Synthetic" }, current: { recordId: "event", updatedAt: "2026-11-03T10:00:00.000Z", stateValues: [{ fieldId: "status", optionId: "a", label: "A" }], extraValues: { related: { id: "actual-record", displayName: "Stored label" } } } }, "status");
  expect(item.attendance?.contextValues?.related).toEqual({ id: "actual-record", displayName: "Stored label" });
 });
 it("captures each relation in the confirmation command; changing it cannot reuse authorization", () => {
  const entry = { personRecordId: "person", statusOptionId: "a", contextValues: { choice: "one", related: "original" } };
  expect(attendanceCommandKey("scope", config, fields, entry)).not.toBe(attendanceCommandKey("scope", config, fields, { ...entry, contextValues: { ...entry.contextValues, related: "different" } }));
  expect(attendanceEntryExtraValues(entry, config, fields)).toEqual({ choice: "canonical_one", related: "original" });
 });
});

it("legacy day snapshots retain related labels while the write command still uses only IDs", () => {
 const item = { person: { id: "person", displayName: "Synthetic" }, attendance: { recordId: "event", observation: null, statusOptionId: "a", statusLabel: "A", updatedAt: "2026-11-03T10:00:00.000Z", contextValues: { related: { id: "record", displayName: "Label" } } } };
 const [snapshot] = attendanceResponseToStateUpdateItems({ appView: { id: "view", name: "Synthetic", slug: "synthetic" }, contextFields: fields, date: "2026-11-03", items: [item], latest: [], statuses: [], sourceEntityType: { id: "subjects", name: "Subjects" }, targetEntityType: { id: "events", name: "Events" }, summary: { totalRegistered: 1 } }, config);
 expect(snapshot.current?.extraValues?.related).toEqual({ id: "record", displayName: "Label" });
 const restored = stateUpdateItemToAttendanceItem(snapshot, "status");
 expect(attendanceEntryExtraValues({ personRecordId: "person", statusOptionId: "a", contextValues: attendanceEditContextValues(fields, restored, {}) }, config, fields)).toEqual({ related: "record" });
});

it("local conflict resolution extracts the ID from a retained relation reference and rejects ambiguous arrays", () => {
 expect(canonicalAttendanceContextValue(fields[1], { id: "retained", displayName: "Stored label" })).toBe("retained");
 expect(() => canonicalAttendanceContextValue(fields[1], ["one", "two"])).toThrow("relación simple válida");
 expect(canonicalAttendanceContextValue(fields[0], "one")).toBe("canonical_one");
});
