import { describe, expect, it } from "vitest";

import {
  buildChangedSubmitValues,
  buildInitialFormValues,
  buildSubmitValues,
  extractApiFieldErrors,
  getWritableFields,
  isFieldUnsupported,
  validateRequiredFields,
} from "./record-form";
import { OpcoApiError } from "./opco-api";
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
