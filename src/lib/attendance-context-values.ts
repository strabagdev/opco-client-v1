import type { EntityRecordValue } from "./opco-api";
import { relationKind, relationKindIsAmbiguous } from "./relation-cardinality";

/** Read projection only. Never rewrites a definition, record or queued command. */
export function readAttendanceContextValue(
  field: { type: string; config?: unknown } | undefined,
  value: EntityRecordValue | undefined,
): EntityRecordValue | undefined {
  if (field?.type !== "RELATION" || relationKindIsAmbiguous(field.config) || relationKind(field.config) !== "ONE" || !Array.isArray(value)) return value;
  // Empty ONE is absent; more than one remains intact and must be reviewed, never truncated.
  if (value.length === 0) return null;
  const only = value[0];
  if (value.length === 1 && (only === null || typeof only === "string" ||
    (only && typeof only === "object" && !Array.isArray(only) && "id" in only && typeof only.id === "string"))) return only as EntityRecordValue;
  return value;
}
