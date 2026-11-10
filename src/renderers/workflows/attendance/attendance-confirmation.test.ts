import { describe, expect, it } from "vitest";
import { attendanceConfirmationRows } from "./attendance-confirmation";
import type { AttendanceContextField, AttendanceWorkflowConfig } from "../../../lib/opco-api";

const config = { workflowKey: "attendance", observationFieldId: "note" } as AttendanceWorkflowConfig;
const fields: AttendanceContextField[] = [
  { id: "shift", name: "Franja", type: "SELECT", required: true, options: [{ optionId: "option-a", value: "a", label: "A" }] },
  { id: "lot", name: "Referencia", type: "RELATION", required: true, config: { relation: { kind: "ONE", targetEntityTypeId: "catalog" } } },
];
const input = {
  config, fields, entry: { personRecordId: "person", statusOptionId: "present", observation: "Nota nueva", contextValues: { shift: "option-a", lot: "record-1" } },
  current: { recordId: "existing", updatedAt: "base", statusOptionId: "present", statusLabel: "Activo", observation: "Nota anterior", contextValues: { shift: { optionId: "option-a", label: "A" }, lot: { id: "record-1", displayName: "Referencia uno" } } },
  currentStatus: "Activo", currentStatusOptionId: "present", requestedStatus: "Activo", relationLabel: () => undefined,
};

describe("captured confirmation presentation", () => {
  it("explains a note-only change while preserving the captured command", () => {
    const before = JSON.stringify(input);
    const rows = attendanceConfirmationRows(input);
    expect(rows[0].changed).toBe(false);
    expect(rows[1]).toEqual({ label: "Observación", current: "Nota anterior", requested: "Nota nueva", changed: true });
    expect(rows[2]).toMatchObject({ current: "A", requested: "A", changed: false });
    expect(rows[3]).toMatchObject({ current: "Referencia uno", requested: "Referencia uno", changed: false });
    expect(JSON.stringify(input)).toBe(before);
  });
  it("uses the conflict snapshot rather than the previous form for remote changes", () => {
    const rows = attendanceConfirmationRows({ ...input, currentExtras: { note: "Remota", shift: "a", lot: { id: "record-2", displayName: "Referencia dos" } }, relationLabel: (_, id) => id === "record-1" ? "Referencia uno" : undefined });
    expect(rows[1].current).toBe("Remota");
    expect(rows[3]).toMatchObject({ current: "Referencia dos", requested: "Referencia uno", changed: true });
  });
  it("never exposes IDs or invents missing original values", () => {
    const rows = attendanceConfirmationRows({ ...input, current: undefined });
    expect(rows[1].current).toBe("No disponible en esta lectura");
    expect(rows[1].changed).toBeNull();
    expect(JSON.stringify(rows)).not.toContain("record-1");
  });
  it("does not crash or reinterpret invalid historical contexts", () => {
    const rows = attendanceConfirmationRows({ ...input, current: { ...input.current, contextValues: { shift: "retired", lot: ["one", "two"] } } });
    expect(rows[2]).toMatchObject({ current: "Selección no disponible", changed: null });
    expect(rows[3]).toMatchObject({ current: "Selección no disponible", changed: null });
  });
  it("compares state identity rather than equal visible labels", () => {
    expect(attendanceConfirmationRows({ ...input, currentStatusOptionId: "other-option" })[0].changed).toBe(true);
  });
  it("does not invent an observation when the workflow has none", () => {
    expect(attendanceConfirmationRows({ ...input, config: { ...config, observationFieldId: undefined } })).toHaveLength(3);
  });
});
