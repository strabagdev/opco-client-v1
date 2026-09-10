import { describe, expect, it } from "vitest";

import { formatConflictValue, formatTechnicalConflictValue } from "./record-conflict-values";

describe("RecordConflictScreen relation formatting", () => {
  it("renders relation labels when resolved and keeps technical ids available", () => {
    const labels = {
      cargo: {
        "e95dc10d-e090-48ff-a2e6-9f5623df7460": "Asistente administrativo",
      },
    };

    expect(formatConflictValue(
      "e95dc10d-e090-48ff-a2e6-9f5623df7460",
      "cargo",
      "RELATION",
      labels,
    )).toBe("Asistente administrativo");
    expect(formatTechnicalConflictValue("e95dc10d-e090-48ff-a2e6-9f5623df7460")).toBe(
      "id: e95dc10d-e090-48ff-a2e6-9f5623df7460",
    );
  });

  it("does not force a UUID-vs-name decision when a relation cannot be resolved", () => {
    expect(formatConflictValue(
      "missing_relation",
      "cargo",
      "RELATION",
      { cargo: {} },
    )).toBe("Referencia no disponible");
  });
});
