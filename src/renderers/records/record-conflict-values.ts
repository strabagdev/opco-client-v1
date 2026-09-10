import { EntityRecordValue } from "@/lib/opco-api";

export function formatConflictValue(
  value: EntityRecordValue | undefined,
  fieldKey: string,
  fieldType: string | null,
  relationLabels: Record<string, Record<string, string>>,
): string {
  if (value === undefined || value === null || value === "") {
    return "Sin valor";
  }

  if (fieldType === "RELATION") {
    const labels = relationLabels[fieldKey] ?? {};

    if (Array.isArray(value)) {
      return value.map((item) => formatConflictRelationValue(item, labels)).join(", ") || "Sin valor";
    }

    return formatConflictRelationValue(value, labels);
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(formatConflictArrayItem).join(", ") || "Sin valor";
  }

  if (typeof value === "object" && "displayName" in value && typeof value.displayName === "string") {
    return value.displayName;
  }

  return "Valor complejo";
}

export function formatTechnicalConflictValue(value: unknown) {
  if (value === undefined) {
    return "id: none";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return `id: ${String(value ?? "none")}`;
  }

  return `id: ${JSON.stringify(value)}`;
}

function formatConflictRelationValue(value: unknown, labels: Record<string, string>) {
  const id = readRelationId(value);

  if (id && labels[id]) {
    return labels[id];
  }

  if (typeof value === "object" && value && "displayName" in value && typeof value.displayName === "string") {
    return value.displayName;
  }

  return "Referencia no disponible";
}

function readRelationId(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
    return value.id;
  }

  return null;
}

function formatConflictArrayItem(value: unknown) {
  if (typeof value === "object" && value && "displayName" in value && typeof value.displayName === "string") {
    return value.displayName;
  }

  return String(value);
}
