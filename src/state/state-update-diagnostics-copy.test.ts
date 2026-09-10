import { describe, expect, it } from "vitest";

import {
  canRetryStateUpdateDiagnosticsCopy,
  formatStateUpdateDiagnosticsCopyText,
  getStateUpdateDiagnosticsCopyButtonText,
} from "./state-update-diagnostics-copy";

describe("state update diagnostics copy text", () => {
  it("copies complete displayed sections and pretty-prints JSON values", () => {
    expect(formatStateUpdateDiagnosticsCopyText([
      {
        rows: [
          ["sync_status", "failed"],
          ["httpStatus", 400],
          ["lastBackendErrorCode", "INVALID_RELATION"],
          ["fieldId", "cargo_field"],
          ["expectedRelationEntityId", "cargo_entity"],
          ["submittedRecordIds", "[\"record_1\"]"],
          ["cause", "Causa no determinada"],
          ["error rejected value", "{\"field\":\"cargo\",\"ids\":[\"record_1\"]}"],
        ],
        title: "Operations #1",
      },
      {
        empty: "No diagnostic run yet.",
        rows: [],
        title: "Diagnostic Run",
      },
    ])).toBe([
      "[Operations #1]",
      "sync_status: failed",
      "httpStatus: 400",
      "lastBackendErrorCode: INVALID_RELATION",
      "fieldId: cargo_field",
      "expectedRelationEntityId: cargo_entity",
      "submittedRecordIds: [",
      "  \"record_1\"",
      "]",
      "cause: Causa no determinada",
      "error rejected value: {",
      "  \"field\": \"cargo\",",
      "  \"ids\": [",
      "    \"record_1\"",
      "  ]",
      "}",
      "",
      "[Diagnostic Run]",
      "No diagnostic run yet.",
    ].join("\n"));
  });

  it("labels copy success and leaves failures retryable", () => {
    expect(getStateUpdateDiagnosticsCopyButtonText("success")).toBe("Copiado");
    expect(getStateUpdateDiagnosticsCopyButtonText("error")).toBe("No se pudo copiar");
    expect(getStateUpdateDiagnosticsCopyButtonText("idle")).toBe("Copiar State Update");
    expect(canRetryStateUpdateDiagnosticsCopy("error")).toBe(true);
    expect(canRetryStateUpdateDiagnosticsCopy("success")).toBe(false);
  });
});
