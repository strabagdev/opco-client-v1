import { describe, expect, it } from "vitest";

import {
  buildChangedSubmitValues,
  buildInitialFormValues,
  buildSubmitValues,
  composeDateTimeValue,
  extractApiFieldErrors,
  getWritableFields,
  isValidDateTimeValue,
  isValidDateValue,
  isValidTimeValue,
  isFieldUnsupported,
  splitDateTimeValue,
  validateFormFields,
  validateRequiredFields,
} from "./record-form";
import { EntityField, OpcoApiError } from "./opco-api";
import { entityDefinitionFixture, entityRecordFixture } from "../test/fixtures";

describe("record form", () => {
  it("builds initial values from record values, including select, multiselect and relation", () => {
    const values = buildInitialFormValues(entityDefinitionFixture, entityRecordFixture.values);

    expect(values.codigo).toBe("EQ-001");
    expect(values.estado).toBe("operativo");
    expect(values.tags).toEqual(["norte"]);
    expect(values.responsable).toBe("person_1");
  });

  it("validates required fields without reimplementing backend rules", () => {
    const fields = getWritableFields(entityDefinitionFixture);

    expect(validateRequiredFields(fields, { codigo: "" })).toEqual({
      codigo: "Este campo es obligatorio.",
    });
  });

  it("recognizes TIME as a writable field type", () => {
    const timeField = field({ key: "hora", required: false, type: "TIME" });

    expect(isFieldUnsupported(timeField)).toBe(false);
  });

  it("validates DATE values without adding timezone semantics", () => {
    expect(isValidDateValue("2026-08-18")).toBe(true);
    expect(isValidDateValue("2026-02-29")).toBe(false);
    expect(isValidDateValue("2026-13-01")).toBe(false);
    expect(isValidDateValue("18-08-2026")).toBe(false);
    expect(validateFormFields([field({ key: "fecha", required: false, type: "DATE" })], { fecha: "2026-13-01" }))
      .toEqual({
        fecha: "Ingresa una fecha valida.",
      });
    expect(buildSubmitValues([field({ key: "fecha", required: false, type: "DATE" })], { fecha: "2026-08-18" }))
      .toEqual({
        fecha: "2026-08-18",
      });
  });

  it("validates TIME values with HH:mm boundaries", () => {
    expect(isValidTimeValue("00:00")).toBe(true);
    expect(isValidTimeValue("08:30")).toBe(true);
    expect(isValidTimeValue("23:59")).toBe(true);
    expect(isValidTimeValue("24:00")).toBe(false);
    expect(isValidTimeValue("12:60")).toBe(false);
    expect(isValidTimeValue("abc")).toBe(false);
    expect(isValidTimeValue("08:5")).toBe(false);
  });

  it("validates required and optional empty TIME values", () => {
    expect(validateFormFields([field({ key: "hora", required: true, type: "TIME" })], { hora: "" })).toEqual({
      hora: "Este campo es obligatorio.",
    });

    expect(validateFormFields([field({ key: "hora", required: false, type: "TIME" })], { hora: "" })).toEqual({});
    expect(buildSubmitValues([field({ key: "hora", required: false, type: "TIME" })], { hora: "" })).toEqual({
      hora: null,
    });
  });

  it("rejects invalid TIME values before submitting", () => {
    expect(validateFormFields([field({ key: "hora", required: false, type: "TIME" })], { hora: "24:00" })).toEqual({
      hora: "Ingresa una hora valida en formato HH:mm.",
    });
  });

  it("validates, splits and composes DATETIME values as ISO timestamps", () => {
    const composed = composeDateTimeValue("2026-08-18", "14:30");

    expect(isValidDateTimeValue(composed)).toBe(true);
    expect(composed).toMatch(/^2026-08-18T/);
    expect(composed).not.toBe("2026-08-18T14:30");
    expect(splitDateTimeValue(composed)).toEqual({
      date: "2026-08-18",
      time: "14:30",
    });
    expect(composeDateTimeValue("2026-08-18", "24:00")).toBe("");
    expect(validateFormFields([field({ key: "inicio", required: false, type: "DATETIME" })], { inicio: "abc" }))
      .toEqual({
        inicio: "Ingresa una fecha y hora validas.",
      });
  });

  it("submits and clears DATETIME values through create and edit payloads", () => {
    const fields = [field({ key: "inicio", required: false, type: "DATETIME" })];
    const value = "2026-08-18T14:30:00.000Z";

    expect(buildInitialFormValues({ ...entityDefinitionFixture, fields }, { inicio: value })).toEqual({
      inicio: value,
    });
    expect(buildSubmitValues(fields, { inicio: value })).toEqual({
      inicio: value,
    });
    expect(buildChangedSubmitValues(fields, { inicio: value }, { inicio: "" })).toEqual({
      inicio: null,
    });
  });

  it("serializes writable JSON values and skips unsupported file/image fields", () => {
    const fields = getWritableFields(entityDefinitionFixture);
    const payload = buildSubmitValues(fields, {
      cantidad: "12",
      codigo: "EQ-002",
      critico: true,
      estado: "operativo",
      foto: "ignored",
      responsable: "person_1",
      tags: ["norte", "sur"],
    });

    expect(payload).toMatchObject({
      cantidad: 12,
      codigo: "EQ-002",
      critico: true,
      estado: "operativo",
      responsable: "person_1",
      tags: ["norte", "sur"],
    });
    expect(payload).not.toHaveProperty("foto");
  });

  it("preloads and submits TIME values without converting them to datetimes", () => {
    const fields = [field({ key: "hora", required: false, type: "TIME" })];

    expect(buildInitialFormValues({ ...entityDefinitionFixture, fields }, { hora: "08:30" })).toEqual({
      hora: "08:30",
    });
    expect(buildSubmitValues(fields, { hora: "08:30" })).toEqual({
      hora: "08:30",
    });
  });

  it("keeps FILE and IMAGE fields visible as unsupported", () => {
    const imageField = entityDefinitionFixture.fields.find((field) => field.type === "IMAGE");

    expect(imageField && isFieldUnsupported(imageField)).toBe(true);
  });

  it("builds partial edit payloads with changed fields only", () => {
    const fields = getWritableFields(entityDefinitionFixture);
    const initialValues = buildInitialFormValues(entityDefinitionFixture, entityRecordFixture.values);
    const currentValues = {
      ...initialValues,
      estado: "inactivo",
    };

    expect(buildChangedSubmitValues(fields, initialValues, currentValues)).toEqual({
      estado: "inactivo",
    });
  });

  it("builds partial edit payloads for changed or cleared TIME fields", () => {
    const fields = [field({ key: "hora", required: false, type: "TIME" })];

    expect(buildChangedSubmitValues(fields, { hora: "08:30" }, { hora: "14:45" })).toEqual({
      hora: "14:45",
    });
    expect(buildChangedSubmitValues(fields, { hora: "08:30" }, { hora: "" })).toEqual({
      hora: null,
    });
  });

  it("extracts API field errors when Opco returns them", () => {
    const error = new OpcoApiError("Validation failed", "VALIDATION_ERROR", 400, {
      fieldErrors: {
        codigo: "Codigo duplicado.",
      },
    });

    expect(extractApiFieldErrors(error)).toEqual({
      codigo: "Codigo duplicado.",
    });
  });
});

function field({
  key,
  required,
  type,
}: {
  key: string;
  required: boolean;
  type: EntityField["type"];
}): EntityField {
  return {
    active: true,
    config: { display: {}, validation: {} },
    id: `field_${key}`,
    key,
    name: key,
    order: 1,
    required,
    type,
  };
}
