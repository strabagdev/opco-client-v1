import { describe, expect, it } from "vitest";

import { attendanceStateFields, attendanceStatusesFromStateFields, stateUpdateItemToAttendanceItem } from "./attendance-offline";

describe("attendance state-update adapter", () => {
  it("maps attendance statuses to a generic state-update field", () => {
    expect(attendanceStateFields(
      [
        { isDefaultCheckIn: true, label: "Presente", optionId: "status_present" },
        { isDefaultCheckIn: false, label: "Ausente", optionId: "status_absent" },
      ],
      { statusFieldId: "field_status" },
      { fieldId: "field_status", label: "Condición" },
    )).toEqual([{
      defaultOptionId: "status_present",
      fieldId: "field_status",
      label: "Condición",
      options: [
        { label: "Presente", optionId: "status_present", order: 0 },
        { label: "Ausente", optionId: "status_absent", order: 1 },
      ],
      required: true,
    }]);
  });

  it("restores dynamic attendance statuses from cached state-update fields", () => {
    const statuses = attendanceStatusesFromStateFields(
      [{
        defaultOptionId: "status_present",
        fieldId: "field_status",
        label: "Estado",
        options: [
          { label: "Presente", optionId: "status_present" },
          { label: "Ausente", optionId: "status_absent" },
          { label: "Atraso", optionId: "status_late" },
        ],
        required: true,
      }],
      "field_status",
      "status_late",
    );

    expect(statuses).toEqual([
      { isDefaultCheckIn: false, label: "Presente", optionId: "status_present" },
      { isDefaultCheckIn: false, label: "Ausente", optionId: "status_absent" },
      { isDefaultCheckIn: true, label: "Atraso", optionId: "status_late" },
    ]);
    expect(statuses).toHaveLength(3);
  });

  it("maps generic state-update items back to the attendance UI shape", () => {
    expect(stateUpdateItemToAttendanceItem({
      current: {
        extraValues: { field_observation: "Turno AM", shift_field: "shift_day" },
        recordId: "state_1",
        stateValues: [{ fieldId: "field_status", label: "Presente", optionId: "status_present" }],
        updatedAt: "2026-08-25T12:00:00.000Z",
      },
      subject: { displayName: "Ana", id: "person_1" },
    }, "field_status", "field_observation")).toEqual({
      attendance: {
        contextValues: { shift_field: "shift_day" },
        observation: "Turno AM",
        recordId: "state_1",
        statusLabel: "Presente",
        statusOptionId: "status_present",
        updatedAt: "2026-08-25T12:00:00.000Z",
      },
      person: { displayName: "Ana", id: "person_1" },
    });
  });

  it("does not infer an observation from text extraValues without observationFieldId", () => {
    expect(stateUpdateItemToAttendanceItem({
      current: {
        extraValues: {
          free_text_context: "Texto de contexto",
          group_field: "grupo_1",
          shift_field: { label: "Turno A", optionId: "shift_a" },
        },
        recordId: "state_1",
        stateValues: [{ fieldId: "field_status", label: "Presente", optionId: "status_present" }],
        updatedAt: "2026-08-25T12:00:00.000Z",
      },
      subject: { displayName: "Ana", id: "person_1" },
    }, "field_status")).toEqual({
      attendance: {
        contextValues: {
          free_text_context: "Texto de contexto",
          group_field: "grupo_1",
          shift_field: { label: "Turno A", optionId: "shift_a" },
        },
        observation: null,
        recordId: "state_1",
        statusLabel: "Presente",
        statusOptionId: "status_present",
        updatedAt: "2026-08-25T12:00:00.000Z",
      },
      person: { displayName: "Ana", id: "person_1" },
    });
  });

  it("reads only observationFieldId as observation when multiple text extraValues exist", () => {
    expect(stateUpdateItemToAttendanceItem({
      current: {
        extraValues: {
          field_observation: "Observación real",
          free_text_context: "Texto de contexto",
          group_field: "grupo_1",
        },
        recordId: "state_1",
        stateValues: [{ fieldId: "field_status", label: "Presente", optionId: "status_present" }],
        updatedAt: "2026-08-25T12:00:00.000Z",
      },
      subject: { displayName: "Ana", id: "person_1" },
    }, "field_status", "field_observation")).toEqual({
      attendance: {
        contextValues: {
          free_text_context: "Texto de contexto",
          group_field: "grupo_1",
        },
        observation: "Observación real",
        recordId: "state_1",
        statusLabel: "Presente",
        statusOptionId: "status_present",
        updatedAt: "2026-08-25T12:00:00.000Z",
      },
      person: { displayName: "Ana", id: "person_1" },
    });
  });
});
