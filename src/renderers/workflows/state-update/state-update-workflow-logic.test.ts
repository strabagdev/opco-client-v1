import { describe, expect, it } from "vitest";

import { EntityField, EntityRecordValue, StateUpdateBatchResult, StateUpdateField } from "@/lib/opco-api";
import { buildEffectiveStateSnapshot, buildStateUpdateConflictRows } from "./state-update-workflow-logic";

const stateFields: StateUpdateField[] = [{
  fieldId: "status_field",
  label: "Estado",
  options: [
    { label: "Presente", optionId: "present_option" },
    { label: "Ausente", optionId: "absent_option" },
  ],
  required: true,
}];

const extraFields: EntityField[] = [
  {
    id: "shift_field",
    key: "shift_field",
    name: "Turno",
    options: [
      { active: true, id: "shift_a", label: "Turno A", order: 1, value: "turno_a" },
      { active: true, id: "shift_b", label: "Turno B", order: 2, value: "turno_b" },
    ],
    order: 1,
    required: false,
    type: "SELECT",
  },
  {
    id: "group_field",
    key: "group_field",
    name: "Grupo",
    options: [
      { active: true, id: "group_1", label: "Grupo 1", order: 1, value: "grupo_1" },
      { active: true, id: "group_2", label: "Grupo 2", order: 2, value: "grupo_2" },
    ],
    order: 2,
    required: false,
    type: "MULTISELECT",
  },
  {
    id: "observation_field",
    key: "observation_field",
    name: "Observacion",
    order: 3,
    required: false,
    type: "TEXTAREA",
  },
];

const multiStateFields: StateUpdateField[] = [
  {
    fieldId: "status_field",
    label: "Estatus",
    options: [
      { label: "Vigente", optionId: "status_active" },
      { label: "En revision", optionId: "status_review" },
      { label: "Archivado", optionId: "status_archived" },
    ],
    required: true,
  },
  {
    fieldId: "version_field",
    label: "Version",
    options: [
      { label: "1", optionId: "version_1" },
      { label: "2", optionId: "version_2" },
      { label: "3", optionId: "version_3" },
    ],
    required: true,
  },
];

describe("state-update effective state snapshot", () => {
  it("sends every state field when only status changes", () => {
    expect(buildEffectiveStateSnapshot({
      currentStateValues: [
        { fieldId: "status_field", label: "Vigente", optionId: "status_active" },
        { fieldId: "version_field", label: "2", optionId: "version_2" },
      ],
      fields: multiStateFields,
      formValues: {
        status_field: "status_review",
        version_field: "version_2",
      },
    })).toEqual({
      error: null,
      hasChanges: true,
      stateValues: [
        { fieldId: "status_field", optionId: "status_review" },
        { fieldId: "version_field", optionId: "version_2" },
      ],
    });
  });

  it("keeps the current status when only version changes", () => {
    expect(buildEffectiveStateSnapshot({
      currentStateValues: [
        { fieldId: "status_field", label: "Vigente", optionId: "status_active" },
        { fieldId: "version_field", label: "2", optionId: "version_2" },
      ],
      fields: multiStateFields,
      formValues: {
        status_field: "status_active",
        version_field: "version_3",
      },
    })).toMatchObject({
      hasChanges: true,
      stateValues: [
        { fieldId: "status_field", optionId: "status_active" },
        { fieldId: "version_field", optionId: "version_3" },
      ],
    });
  });

  it("uses both new values when both state fields change", () => {
    expect(buildEffectiveStateSnapshot({
      currentStateValues: [
        { fieldId: "status_field", label: "Vigente", optionId: "status_active" },
        { fieldId: "version_field", label: "2", optionId: "version_2" },
      ],
      fields: multiStateFields,
      formValues: {
        status_field: "status_archived",
        version_field: "version_3",
      },
    })).toMatchObject({
      hasChanges: true,
      stateValues: [
        { fieldId: "status_field", optionId: "status_archived" },
        { fieldId: "version_field", optionId: "version_3" },
      ],
    });
  });

  it("builds the first event without current values", () => {
    expect(buildEffectiveStateSnapshot({
      fields: multiStateFields,
      formValues: {
        status_field: "status_active",
        version_field: "version_1",
      },
    })).toMatchObject({
      hasChanges: true,
      stateValues: [
        { fieldId: "status_field", optionId: "status_active" },
        { fieldId: "version_field", optionId: "version_1" },
      ],
    });
  });

  it("blocks required state fields that still have no effective value", () => {
    expect(buildEffectiveStateSnapshot({
      fields: multiStateFields,
      formValues: {
        status_field: "status_active",
      },
    })).toEqual({
      error: "Version es obligatorio.",
      hasChanges: true,
      stateValues: [
        { fieldId: "status_field", optionId: "status_active" },
      ],
    });
  });

  it("uses a valid configured default when no current or form value exists", () => {
    expect(buildEffectiveStateSnapshot({
      fields: [{
        ...multiStateFields[0],
        defaultOptionId: "status_active",
      }],
      formValues: {},
    })).toEqual({
      error: null,
      hasChanges: true,
      stateValues: [
        { fieldId: "status_field", optionId: "status_active" },
      ],
    });
  });

  it("does not invent null values for optional fields without an effective value", () => {
    expect(buildEffectiveStateSnapshot({
      fields: [{
        ...multiStateFields[0],
        required: false,
      }],
      formValues: {},
    })).toEqual({
      error: null,
      hasChanges: false,
      stateValues: [],
    });
  });

  it("keeps the N=1 unchanged state as a snapshot without treating it as a change", () => {
    expect(buildEffectiveStateSnapshot({
      currentStateValues: [{ fieldId: "status_field", label: "Vigente", optionId: "status_active" }],
      fields: [multiStateFields[0]],
      formValues: {
        status_field: "status_active",
      },
    })).toEqual({
      error: null,
      hasChanges: false,
      stateValues: [
        { fieldId: "status_field", optionId: "status_active" },
      ],
    });
  });
});

describe("state-update conflict rows", () => {
  it("keeps state-only conflicts unchanged", () => {
    expect(buildStateUpdateConflictRows(conflictResult({
      existingStateValues: [{ fieldId: "status_field", label: "Ausente", optionId: "absent_option" }],
      requestedStateValues: [{ fieldId: "status_field", label: "Presente", optionId: "present_option" }],
    }), stateFields, extraFields)).toEqual([{
      existing: "Ausente",
      fieldId: "status_field",
      fieldType: "STATE",
      label: "Estado",
      requested: "Presente",
      technicalExisting: "absent_option",
      technicalRequested: "present_option",
    }]);
  });

  it("renders SELECT and MULTISELECT extraValue conflicts with labels from the definition", () => {
    expect(buildStateUpdateConflictRows(conflictResult({
      extraValues: [
        { fieldId: "shift_field", localValue: "turno_a", remoteValue: "turno_b" },
        { fieldId: "group_field", localValue: ["grupo_1"], remoteValue: ["grupo_2"] },
      ],
      existingExtraValues: {
        group_field: ["grupo_2"],
        shift_field: "turno_b",
      },
      requestedExtraValues: {
        group_field: ["grupo_1"],
        shift_field: "turno_a",
      },
    }), stateFields, extraFields)).toMatchObject([
      {
        existing: "Turno B",
        fieldId: "shift_field",
        label: "Turno",
        requested: "Turno A",
        technicalExisting: "turno_b",
        technicalRequested: "turno_a",
      },
      {
        existing: "Grupo 2",
        fieldId: "group_field",
        label: "Grupo",
        requested: "Grupo 1",
        technicalExisting: ["grupo_2"],
        technicalRequested: ["grupo_1"],
      },
    ]);
  });

  it("renders extraValue conflicts from difference metadata when value maps are not present", () => {
    expect(buildStateUpdateConflictRows(conflictResult({
      extraValues: [
        { fieldId: "shift_field", localValue: "turno_a", remoteValue: "turno_b" },
      ],
    }), stateFields, extraFields)).toMatchObject([
      {
        existing: "Turno B",
        fieldId: "shift_field",
        label: "Turno",
        requested: "Turno A",
      },
    ]);
  });

  it("renders mixed stateValues and TEXTAREA extraValues", () => {
    expect(buildStateUpdateConflictRows(conflictResult({
      existingExtraValues: { observation_field: "Remoto" },
      existingStateValues: [{ fieldId: "status_field", label: "Ausente", optionId: "absent_option" }],
      requestedExtraValues: { observation_field: "Local" },
      requestedStateValues: [{ fieldId: "status_field", label: "Presente", optionId: "present_option" }],
    }), stateFields, extraFields)).toMatchObject([
      { existing: "Ausente", fieldId: "status_field", requested: "Presente" },
      { existing: "Remoto", fieldId: "observation_field", label: "Observacion", requested: "Local" },
    ]);
  });

  it("keeps unknown extra fields visible with a technical fallback", () => {
    expect(buildStateUpdateConflictRows(conflictResult({
      existingExtraValues: { field_unknown_context: "remoto" },
      requestedExtraValues: { field_unknown_context: "local" },
    }), stateFields, [])).toEqual([{
      existing: "remoto",
      fieldId: "field_unknown_context",
      fieldType: null,
      label: "Campo field_un",
      requested: "local",
      technicalExisting: "remoto",
      technicalRequested: "local",
    }]);
  });
});

function conflictResult({
  existingExtraValues,
  existingStateValues = [],
  extraValues,
  requestedExtraValues,
  requestedStateValues = [],
}: {
  existingExtraValues?: Record<string, EntityRecordValue>;
  existingStateValues?: Extract<StateUpdateBatchResult, { result: "CONFLICT" }>["existing"]["stateValues"];
  extraValues?: Extract<StateUpdateBatchResult, { result: "CONFLICT" }>["extraValues"];
  requestedExtraValues?: Record<string, EntityRecordValue>;
  requestedStateValues?: Extract<StateUpdateBatchResult, { result: "CONFLICT" }>["requested"]["stateValues"];
}): Extract<StateUpdateBatchResult, { result: "CONFLICT" }> {
  return {
    existing: {
      extraValues: existingExtraValues,
      recordId: "state_1",
      stateValues: existingStateValues,
      updatedAt: "2026-08-26T12:00:00.000Z",
    },
    extraValues,
    requested: {
      extraValues: requestedExtraValues,
      stateValues: requestedStateValues,
    },
    result: "CONFLICT",
    subjectRecordId: "person_1",
  };
}
