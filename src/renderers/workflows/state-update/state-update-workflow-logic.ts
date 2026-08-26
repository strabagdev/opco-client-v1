import {
  StateUpdateBatchResult,
  StateUpdateCurrentFieldValue,
  StateUpdateField,
  StateUpdateOption,
} from "@/lib/opco-api";

export const STATE_UPDATE_SEARCH_DEBOUNCE_MS = 300;

export function formatLocalDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function shiftLocalDate(value: string, amount: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  date.setDate(date.getDate() + amount);

  return formatLocalDateInput(date);
}

export function normalizeStateUpdateSearch(value: string) {
  return value.trim();
}

export function shouldSearchStateUpdateSubjects(value: string) {
  return normalizeStateUpdateSearch(value).length > 0;
}

export function defaultStateValues(fields: StateUpdateField[]) {
  return fields.reduce<Record<string, string>>((values, field) => {
    values[field.fieldId] = field.defaultOptionId ?? "";

    return values;
  }, {});
}

export function stateFieldOptionLabel(field: StateUpdateField, optionId: string | null | undefined) {
  if (!optionId) {
    return null;
  }

  return field.options.find((option) => option.optionId === optionId)?.label ?? null;
}

export function activeStateOptions(field: StateUpdateField): StateUpdateOption[] {
  return [...field.options]
    .filter((option) => option.active !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function currentStateValue(values: StateUpdateCurrentFieldValue[], fieldId: string) {
  return values.find((value) => value.fieldId === fieldId) ?? null;
}

export function firstBlockingStateUpdateResult(results: StateUpdateBatchResult[]) {
  return results.find((result) => result.result === "CONFLICT" || result.result === "ERROR") ?? null;
}

export function hasSuccessfulStateUpdateResult(results: StateUpdateBatchResult[]) {
  return results.some((result) => (
    result.result === "CREATED" ||
    result.result === "UNCHANGED" ||
    result.result === "UPDATED"
  ));
}

export function stateUpdateSuccessLabel(result: StateUpdateBatchResult | undefined, updateLabel: string, createLabel: string) {
  if (!result) {
    return createLabel;
  }

  if (result.result === "UNCHANGED") {
    return "El estado ya estaba registrado.";
  }

  if (result.result === "UPDATED") {
    return updateLabel;
  }

  return createLabel;
}
