import { describe, expect, it } from "vitest";

import { attendanceStateFields, stateUpdateItemToAttendanceItem } from "./attendance-offline";

describe("attendance state-update adapter", () => {
  it("maps attendance statuses to a generic state-update field", () => {
    expect(attendanceStateFields(
      [
        { isDefaultCheckIn: true, label: "Presente", optionId: "status_present" },
        { isDefaultCheckIn: false, label: "Ausente", optionId: "status_absent" },
      ],
      { statusFieldId: "field_status" },
    )).toEqual([{
      defaultOptionId: "status_present",
      fieldId: "field_status",
      label: "Estado",
      options: [
        { label: "Presente", optionId: "status_present", order: 0 },
        { label: "Ausente", optionId: "status_absent", order: 1 },
      ],
      required: true,
    }]);
  });

  it("maps generic state-update items back to the attendance UI shape", () => {
    expect(stateUpdateItemToAttendanceItem({
      current: {
        extraValues: { field_observation: "Turno AM" },
        recordId: "state_1",
        stateValues: [{ fieldId: "field_status", label: "Presente", optionId: "status_present" }],
        updatedAt: "2026-08-25T12:00:00.000Z",
      },
      subject: { displayName: "Ana", id: "person_1" },
    }, "field_status")).toEqual({
      attendance: {
        observation: "Turno AM",
        recordId: "state_1",
        statusLabel: "Presente",
        statusOptionId: "status_present",
        updatedAt: "2026-08-25T12:00:00.000Z",
      },
      person: { displayName: "Ana", id: "person_1" },
    });
  });
});
