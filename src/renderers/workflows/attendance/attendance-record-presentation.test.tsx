import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttendanceRecordRow, copyAttendanceReference } from "./attendance-record-list";
import { attendanceTimestamp, distinctAttendancePresentations, loadAttendanceRecordPresentation, type AttendanceReadRecord, type AttendancePresentationStore } from "./attendance-record-presentation";
vi.mock("react-native", async () => import("react-native-web"));
const scope = { ownerKey: "owner", contractId: "contract", appViewId: "view", targetEntityTypeId: "events", date: "2026-11-03" };
const record: AttendanceReadRecord = { recordId: "server-id", person: { id: "person", displayName: "Sujeto sintético" }, statusLabel: "A", statusOptionId: "a", eventOccurredAt: "2026-11-04T02:00:00.000Z", updatedAt: "2026-11-04T03:00:00.000Z" };
const store = (local = false) => ({ getAttendanceDailyRecords: vi.fn(async () => []), getCachedRecord: vi.fn(async () => ({ id: "server-id", localId: local ? "state_update_view_00000000-0000-4000-8000-000000000001" : "state_update_snapshot_internal-key", serverId: "server-id", remoteUpdatedAt: record.updatedAt, syncStatus: "synced", values: local ? { __opcoStateUpdateIntent: 1, eventOccurredAt: record.eventOccurredAt } : {} })) }) as unknown as AttendancePresentationStore;
afterEach(() => vi.unstubAllGlobals());
describe("Attendance read presentation, without command or DATE changes", () => {
  it("keeps a local creation identity after the server has assigned a different alias", async () => {
    const data = store(true), result = await loadAttendanceRecordPresentation(data, scope, record, []);
    expect(result).toMatchObject({ reference: "state_update_view_00000000-0000-4000-8000-000000000001", referenceKind: "local", serverId: "server-id" });
    expect(result.timestamps.map(t => t.label)).toEqual(["Hora de captura", "Última modificación"]);
    expect(data.getCachedRecord).toHaveBeenNthCalledWith(1, { ownerKey: "owner", contractId: "contract", appViewId: "view", date: scope.date, entityTypeId: "events", recordId: "server-id" });
    expect(data.getCachedRecord).toHaveBeenNthCalledWith(2, { ownerKey: "owner", contractId: "contract", entityTypeId: "events", recordId: "state_update_view_00000000-0000-4000-8000-000000000001" });
  });
  it("does not attribute historical server fallback times to a device capture", async () => {
    const result = await loadAttendanceRecordPresentation(store(), scope, record, []);
    expect(result.reference).toBe("server-id");
    expect(result.timestamps.map(t => t.label)).toEqual(["Hora de referencia", "Última modificación"]);
    expect(result.timestamps.some(t => t.label === "Creado en servidor")).toBe(false);
  });
  it("shows a capture even without updatedAt and shows explicit zones, seconds and date", async () => {
    const result = await loadAttendanceRecordPresentation(store(true), scope, { ...record, updatedAt: "" }, [], [], "America/Santiago");
    expect(result.timestamps[0].label).toBe("Hora de captura");
    expect(result.timestamps[0].text).toContain("America/Santiago");
    expect(attendanceTimestamp("Hora de referencia", record.eventOccurredAt, "invalid/zone")?.text).toContain("UTC");
    expect(attendanceTimestamp("Hora de referencia", "invalid")).toBeNull();
  });
  it("shows configured SELECT and embedded historical ONE labels, never relation IDs", async () => {
    const result = await loadAttendanceRecordPresentation(store(), scope, { ...record, contextValues: { choice: { optionId: "n", label: "Sector guardado" }, relation: [{ id: "technical-related-id", displayName: "Equipo sintético" }] } }, [
      { id: "choice", name: "Área configurable", type: "SELECT", required: false, options: [{ optionId: "n", value: "NORTH", label: "Sector actual" }] },
      { id: "relation", name: "Objeto configurable", type: "RELATION", required: false, config: { relationKind: "ONE", targetEntityTypeId: "catalog" } },
    ]);
    expect(result.fields.map(f => f.label)).toEqual(["Estado", "Área configurable", "Objeto configurable"]);
    expect(result.fields.map(f => f.values[0].text)).toEqual(["A", "Sector guardado", "Equipo sintético"]);
    expect(JSON.stringify(result.fields)).not.toContain("technical-related-id");
  });
  it("does not invent labels for unknown or ambiguous SELECT/relation values", async () => {
    const data = { getCachedRecord: vi.fn(async () => null), getAttendanceDailyRecords: vi.fn(async () => []) } as unknown as AttendancePresentationStore;
    const result = await loadAttendanceRecordPresentation(data, scope, { ...record, contextValues: { choice: "x", relation: "opaque-related-id" } }, [
      { id: "choice", name: "Área", type: "SELECT", required: false, options: [{ optionId: "x", value: "other", label: "Uno" }, { optionId: "y", value: "x", label: "Dos" }] },
      { id: "relation", name: "Objeto", type: "RELATION", required: false, config: { relationKind: "ONE", targetEntityTypeId: "catalog" } },
      { id: "absent", name: "Sin cobertura", type: "SELECT", required: false, options: [] },
    ]);
    expect(result.fields.slice(1).map(f => f.values[0].status)).toEqual(["unavailable", "unavailable", "unavailable"]);
    expect(JSON.stringify(result.fields)).not.toContain("opaque-related-id");
  });
  it("uses all characters of colliding prefixes and keeps independent rows with identical visible values", async () => {
    const first = await loadAttendanceRecordPresentation(store(), scope, record, []);
    const rows = ["same-prefix-111111", "same-prefix-111112"].map(reference => ({ ...first, reference, serverId: reference, record: { ...first.record, recordId: reference } }));
    expect(distinctAttendancePresentations(rows)).toHaveLength(2);
    const html = renderToStaticMarkup(<>{rows.map(row => <AttendanceRecordRow key={row.reference} row={row} onEdit={vi.fn()} />)}</>);
    expect(html).toContain("same-prefix-111111"); expect(html).toContain("same-prefix-111112");
    expect(html).toContain("Editar registro same-prefix-111111"); expect(html).not.toContain("Registro 1");
    expect(distinctAttendancePresentations([rows[0], rows[0], rows[1]])).toHaveLength(2);
  });
  it("copies the full reference without shortening or adding formatting characters", async () => {
    const writeText = vi.fn(async () => undefined); vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyAttendanceReference("same-prefix-111111");expect(writeText).toHaveBeenCalledWith("same-prefix-111111");
    writeText.mockRejectedValueOnce(Error("Denied"));await expect(copyAttendanceReference("another-id")).rejects.toThrow("Denied");
  });
});

it("prioritizes editing and operational values before full secondary identifiers", async () => {
  const row = await loadAttendanceRecordPresentation(store(true), scope, record, []);
  const html = renderToStaticMarkup(<AttendanceRecordRow row={row} selected onEdit={vi.fn()} />);
  expect(html.indexOf(">Editar<")).toBeLessThan(html.indexOf(">Estado<"));
  expect(html).toContain("Editando este registro");
  expect(html).not.toContain(">Referencia local fija<");
  expect(html).not.toContain(">Copiar referencia<");
  expect(html).toContain(">Detalle técnico<");
  expect(html).toContain(`Editar registro ${row.reference}`);
  expect(html).not.toContain(`>${row.reference}<`);
});

it("groups by related subject ID, preserves configured presentation, and never combines equal labels", async () => {
  const { groupAttendancePresentations } = await import("./attendance-record-presentation");
  const one = await loadAttendanceRecordPresentation(store(), scope, record, []);
  const two = { ...one, reference: "other-event", serverId: "other-event", record: { ...record, recordId: "other-event" } };
  const otherSubject = { ...two, record: { ...two.record, person: { ...record.person, id: "different-person" } } };
  const groups = groupAttendancePresentations([one, two, otherSubject]);
  expect(groups.map(g => [g.subject.id, g.rows.length])).toEqual([[record.person.id, 2], ["different-person", 1]]);
});

it("counts a pending identity, its ACK and its remote snapshot once without merging independent events", async () => {
  const row = await loadAttendanceRecordPresentation(store(), scope, record, []);
  const local = { ...row, reference: "local-event", referenceKind: "local" as const, serverId: undefined,
    syncLabel: "Cambio local · pendiente", record: { ...record, recordId: "local-event", statusLabel: "B" } };
  const ack = { ...local, serverId: "server-id", syncLabel: undefined };
  const independent = { ...row, reference: "server-two", serverId: "server-two", record: { ...record, recordId: "server-two" } };
  const unique = distinctAttendancePresentations([local, row, ack, independent]);
  expect(unique).toHaveLength(2);
  expect(unique[0].record.statusLabel).toBe("B");
});

it("shows a configured subject name from the exact scoped offline source row", async () => {
  const { readAttendancePresentedSubject } = await import("./attendance-record-presentation");
  const { presentationFingerprint } = await import("../../../lib/subject-presentation");
  const config={version:1 as const,titleFieldIds:["code"],secondaryFieldIds:["name"]};
  const fields=[{id:"code",key:"code",name:"Código",type:"TEXT",multiple:false},{id:"name",key:"name",name:"Nombre",type:"TEXT",multiple:false}];
  const definition={version:1 as const,sourceEntityTypeId:"people",config,fields,fingerprint:presentationFingerprint("people",config,fields)};
  const data=store();
  vi.mocked(data.getCachedRecord).mockResolvedValue({localId:"person-cache",serverId:"person",values:{code:"S-001",name:"Nombre configurado"}} as never);
  const result=await readAttendancePresentedSubject(data,scope,record.person,config,definition);
  expect(result.presentation?.cells.map(c=>c.value)).toEqual(["S-001","Nombre configurado"]);
  expect(result.id).toBe(record.person.id);
  expect(data.getCachedRecord).toHaveBeenCalledWith({ownerKey:"owner",contractId:"contract",entityTypeId:"people",recordId:"person"});
  vi.mocked(data.getCachedRecord).mockResolvedValue({localId:"other",serverId:"another-person",values:{code:"OTHER"}} as never);
  expect(await readAttendancePresentedSubject(data,scope,record.person,config,definition)).toBe(record.person);
  expect(await readAttendancePresentedSubject(data,scope,record.person,config,{...definition,fingerprint:"incompatible"})).toBe(record.person);
});

it("keeps configured capture compact and puts seconds, provenance and full IDs behind details",async()=>{const captureTime={version:1 as const,fieldId:"capture",timeZone:"America/Santiago",value:"2026-11-04T02:30:45.123Z",source:"DEVICE_CONFIRMATION" as const};const row=await loadAttendanceRecordPresentation(store(),scope,{...record,captureTime},[]);const html=renderToStaticMarkup(<AttendanceRecordRow row={row} onEdit={vi.fn()}/>);expect(html).toContain("Hora de captura: 23:30");expect(html).not.toContain("23:30:45");expect(html).not.toContain("reloj del dispositivo");expect(html).not.toContain(">ID completo en servidor<");expect(html).toContain("Detalle técnico");});
