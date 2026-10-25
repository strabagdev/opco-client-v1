import { describe, expect, it } from "vitest";
import { decimalFractionLength, formatConfiguredDecimal } from "./decimal-precision";
import { buildSubmitValues, validateFormFields } from "./record-form";
import type { EntityField } from "./opco-api";

describe("configured DECIMAL precision", () => {
  const config = { validation: { decimalPlaces: 1 } };
  const field: EntityField = { id: "hours", key: "hours", name: "Lectura", type: "DECIMAL", required: true, config };
  it("rejects excessive precision without truncating or accepting partial numeric input", () => {
    expect(validateFormFields([field], { hours: "12.3" })).toEqual({});
    expect(validateFormFields([field], { hours: "12.300" })).toEqual({});
    for (const hours of ["12.34", "12abc", "1e-2"]) expect(validateFormFields([field], { hours }).hours).toBeTruthy();
    expect(decimalFractionLength("1.200e-1")).toBe(2);
  });
  it("pads compatible values, never silently rounds existing values", () => {
    expect(formatConfiguredDecimal("12", config)).toBe("12.0");
    expect(formatConfiguredDecimal("12.34", config)).toBe("12.34");
    expect(formatConfiguredDecimal("12.340000", config)).toBe("12.340000");
    expect(formatConfiguredDecimal("12")).toBe("12");
    expect(formatConfiguredDecimal("1234567890123.1", config)).toBe("1234567890123.1");
    expect(buildSubmitValues([field], { hours: "1234567890123.1" })).toEqual({ hours: "1234567890123.1" });
  });
});
