/** relationKind owns cardinality. The generic boolean is retained as a compatibility mirror. */
export type RelationKind = "ONE" | "MANY";
type Field = { type?: string; multiple?: boolean; config?: unknown };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const kind = (value: unknown): value is RelationKind => value === "ONE" || value === "MANY";
export function relationKind(config: unknown): RelationKind {
  const flat = object(config), nested = object(flat.relation);
  return kind(flat.relationKind) ? flat.relationKind : kind(nested.relationKind) ? nested.relationKind : "ONE";
}
export function relationKindIsAmbiguous(config: unknown): boolean {
  const flat = object(config), nested = object(flat.relation);
  return (flat.relationKind !== undefined && !kind(flat.relationKind)) || (nested.relationKind !== undefined && !kind(nested.relationKind)) ||
    (kind(flat.relationKind) && kind(nested.relationKind) && flat.relationKind !== nested.relationKind);
}
export function relationCardinalityIssue(field: Field): string | null {
  if (field.type !== "RELATION") return null;
  const flat = object(field.config), nested = object(flat.relation);
  if ((flat.relationKind !== undefined && !kind(flat.relationKind)) || (nested.relationKind !== undefined && !kind(nested.relationKind)) ||
      (kind(flat.relationKind) && kind(nested.relationKind) && flat.relationKind !== nested.relationKind) ||
      (typeof field.multiple === "boolean" && field.multiple !== (relationKind(field.config) === "MANY"))) {
    return "La cardinalidad de esta relación es incoherente. Revisa su definición; los valores conservados no se modifican.";
  }
  return null;
}
