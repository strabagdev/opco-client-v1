import { describe, expect, it } from "vitest";

import { EntityField, EntityRecordValue, StateUpdateBatchResult, StateUpdateField } from "@/lib/opco-api";
import {
  buildEffectiveStateSnapshot,
  buildStateUpdateConflictRows,
  defaultStateValues,
  formValueFromStateValue,
  formatStateValueLabel,
} from "./state-update-workflow-logic";

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

const scalarStateFields: StateUpdateField[] = [
  {
    fieldId: "condition_field",
    label: "Condicion",
    options: [],
    required: true,
    type: "TEXT",
  },
  {
    fieldId: "counter_field",
    label: "Contador",
    options: [],
    required: true,
    type: "INTEGER",
  },
  {
    fieldId: "score_field",
    label: "Score",
    options: [],
    required: true,
    type: "DECIMAL",
  },
  {
    fieldId: "budget_field",
    label: "Presupuesto",
    options: [],
    required: true,
    type: "MONEY",
  },
  {
    fieldId: "due_date_field",
    label: "Fecha limite",
    options: [],
    required: true,
    type: "DATE",
  },
  {
    fieldId: "active_field",
    label: "Activo",
    options: [],
    required: true,
    type: "BOOLEAN",
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

  it("builds scalar state field snapshots with typed values", () => {
    expect(buildEffectiveStateSnapshot({
      currentStateValues: [
        { fieldId: "condition_field", label: "Anterior", optionId: null, value: "Anterior" },
        { fieldId: "counter_field", label: "0", optionId: null, value: 0 },
        { fieldId: "score_field", label: "1.5", optionId: null, value: 1.5 },
        { fieldId: "budget_field", label: "10", optionId: null, value: 10 },
        { fieldId: "due_date_field", label: "2026-08-30", optionId: null, value: "2026-08-30T00:00:00.000Z" },
        { fieldId: "active_field", label: "No", optionId: null, value: false },
      ],
      fields: scalarStateFields,
      formValues: {
        active_field: true,
        budget_field: "0",
        condition_field: " Operando ",
        counter_field: "0",
        due_date_field: "2026-09-01",
        score_field: "2.75",
      },
    })).toEqual({
      error: null,
      hasChanges: true,
      stateValues: [
        { fieldId: "condition_field", optionId: null, value: "Operando" },
        { fieldId: "counter_field", optionId: null, value: 0 },
        { fieldId: "score_field", optionId: null, value: 2.75 },
        { fieldId: "budget_field", optionId: null, value: 0 },
        { fieldId: "due_date_field", optionId: null, value: "2026-09-01" },
        { fieldId: "active_field", optionId: null, value: true },
      ],
    });
  });

  it("validates required scalar values by their field type", () => {
    expect(buildEffectiveStateSnapshot({
      fields: [scalarStateFields[1]],
      formValues: { counter_field: "1.5" },
    })).toMatchObject({ error: "Contador debe ser un entero valido." });

    expect(buildEffectiveStateSnapshot({
      fields: [scalarStateFields[4]],
      formValues: { due_date_field: "2026-02-31" },
    })).toMatchObject({ error: "Fecha limite debe ser una fecha valida." });
  });

  it("derives generic state field form values and labels by type", () => {
    expect(defaultStateValues(scalarStateFields)).toMatchObject({ active_field: false });
    expect(formValueFromStateValue(scalarStateFields[4], {
      fieldId: "due_date_field",
      label: "2026-09-01",
      optionId: null,
      value: "2026-09-01T00:00:00.000Z",
    })).toBe("2026-09-01");
    expect(formatStateValueLabel(scalarStateFields[5], {
      fieldId: "active_field",
      label: null,
      optionId: null,
      value: false,
    })).toBe("No");
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

  it("renders scalar stateValue conflicts with technical values", () => {
    expect(buildStateUpdateConflictRows(conflictResult({
      existingStateValues: [{ fieldId: "active_field", label: null, optionId: null, value: false }],
      requestedStateValues: [{ fieldId: "active_field", label: null, optionId: null, value: true }],
    }), [scalarStateFields[5]], extraFields)).toEqual([{
      existing: "No",
      fieldId: "active_field",
      fieldType: "STATE",
      label: "Activo",
      requested: "Si",
      technicalExisting: false,
      technicalRequested: true,
    }]);
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
