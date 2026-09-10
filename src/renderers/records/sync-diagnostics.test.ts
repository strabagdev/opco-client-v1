import { describe, expect, it } from "vitest";

import {
  formatRecordsFailedOperationDiagnosticsCopyText,
  getRecordsFailedOperationDiagnosticsSections,
} from "./sync-diagnostics";
import type { RecordsFailedOperationDiagnostics } from "@/lib/offline-records";

describe("records sync diagnostics", () => {
  it("renders and copies structured INVALID_RELATION details with full identifiers", () => {
    const operations: RecordsFailedOperationDiagnostics[] = [
      {
        entityTypeId: "entity_people_full",
        hasStructuredDetails: true,
        lastErrorCode: "INVALID_RELATION",
        lastErrorDetails: {
          entityTypeId: null,
          fields: [
            {
              expectedType: "RELATION_TARGET_RECORD",
              fieldId: "field_cargo_full",
              fieldLabel: "Cargo",
              fieldType: "RELATION",
              messages: ["cargo_missing_full: REFERENCE_NOT_FOUND"],
              rejectedValue: ["cargo_missing_full"],
              relatedEntityTypeId: "entity_cargo_full",
              relatedEntityTypeName: "Cargos",
              relationIssues: [
                {
                  actualEntityTypeId: null,
                  actualEntityTypeName: null,
                  cause: "REFERENCE_NOT_FOUND",
                  fieldId: "field_cargo_full",
                  fieldName: "Cargo",
                  relatedEntityTypeId: "entity_cargo_full",
                  relatedEntityTypeName: "Cargos",
                  targetRecordId: "cargo_missing_full",
                },
              ],
              source: "relation",
              submittedRecordIds: ["cargo_missing_full"],
            },
          ],
        },
        lastErrorMessage: "Cargo contiene registros relacionados no validos.",
        lastHttpStatus: 400,
        localRecordId: "local_record_full",
        manualRetryToken: "records:local_record_full",
        manualRetryable: true,
        operation: "CREATE",
        retryCount: 1,
        serverRecordId: null,
        syncErrorCode: "INVALID_RELATION",
        syncErrorMessage: "Cargo contiene registros relacionados no validos.",
        syncStatus: "failed",
        updatedAt: "2026-09-10T12:00:00.000Z",
      },
    ];

    const sections = getRecordsFailedOperationDiagnosticsSections(operations);
    const copyText = formatRecordsFailedOperationDiagnosticsCopyText(sections);

    expect(sections[0].manualRetryToken).toBe("records:local_record_full");
    expect(copyText).toContain("HTTP status: 400");
    expect(copyText).toContain("fieldId: field_cargo_full");
    expect(copyText).toContain("expectedRelationEntityId: entity_cargo_full");
    expect(copyText).toContain("submittedRecordIds: [\n  \"cargo_missing_full\"\n]");
    expect(copyText).toContain("relationTargetRecordId: cargo_missing_full");
    expect(copyText).toContain("cause: REFERENCE_NOT_FOUND");
  });

  it("keeps legacy RECORDS failures retryable when no structured detail was stored", () => {
    const sections = getRecordsFailedOperationDiagnosticsSections([
      {
        entityTypeId: "entity_people_full",
        hasStructuredDetails: false,
        lastErrorCode: "INVALID_RELATION",
        lastErrorDetails: null,
        lastErrorMessage: "Cargo contiene registros relacionados no validos.",
        lastHttpStatus: null,
        localRecordId: "local_record_full",
        manualRetryToken: "records:local_record_full",
        manualRetryable: true,
        operation: "UPDATE",
        retryCount: 1,
        serverRecordId: "server_record_full",
        syncErrorCode: "INVALID_RELATION",
        syncErrorMessage: "Cargo contiene registros relacionados no validos.",
        syncStatus: "failed",
        updatedAt: "2026-09-10T12:00:00.000Z",
      },
    ]);

    expect(formatRecordsFailedOperationDiagnosticsCopyText(sections)).toContain(
      "Este rechazo no contiene detalle técnico; reintenta para actualizarlo",
    );
  });
});
