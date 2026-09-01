import { describe, expect, it } from "vitest";

import { EntityField } from "@/lib/opco-api";
import { attendanceContextFieldsFromPreparedDefinition, attendanceEntryExtraValues } from "./attendance-workflow-logic";

describe("AttendanceWorkflow prepared context fields", () => {
  it("preserves FieldOption.value when rebuilding SELECT context fields from cached definitions", () => {
    const fields: EntityField[] = [
      {
        id: "shift_field",
        key: "turno",
        name: "Turno",
        options: [
          { active: true, id: "shift_a", label: "Turno A", order: 0, value: "turno_a" },
        ],
        required: true,
        type: "SELECT",
      },
      {
        id: "group_field",
        key: "grupo",
        name: "Grupo",
        options: [
          { active: true, id: "group_1", label: "Grupo 1", order: 0, value: "grupo_1" },
        ],
        required: true,
        type: "SELECT",
      },
    ];

    const contextFields = attendanceContextFieldsFromPreparedDefinition(fields, ["shift_field", "group_field"]);

    expect(contextFields).toMatchObject([
      {
        id: "shift_field",
        options: [{ optionId: "shift_a", value: "turno_a" }],
      },
      {
        id: "group_field",
        options: [{ optionId: "group_1", value: "grupo_1" }],
      },
    ]);
    expect(attendanceEntryExtraValues({
      contextValues: {
        group_field: "group_1",
        shift_field: "shift_a",
      },
      personRecordId: "person_1",
      statusOptionId: "present_option",
    }, {
      contextFieldIds: ["shift_field", "group_field"],
      dateFieldId: "date_field",
      personFieldId: "person_field",
      sourceEntityTypeId: "people",
      statusFieldId: "status_field",
      targetEntityTypeId: "attendance",
      workflowKey: "attendance",
    }, contextFields)).toEqual({
      group_field: "grupo_1",
      shift_field: "turno_a",
    });
  });
});
