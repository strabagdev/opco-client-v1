export type TemporalFieldInputProps = {
  onChange(value: string): void;
  required: boolean;
  value: string;
  label?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
};

// String comparisons are safe only for complete logical YYYY-MM-DD / YYYY-MM values.
export function temporalSelectionAllowed(value: string, props: Pick<TemporalFieldInputProps, "required" | "min" | "max">) {
  if (!value) return !props.required;
  return (!props.min || value >= props.min) && (!props.max || value <= props.max);
}

/** DATE presentation accepts the historical ISO DTO without interpreting it as an instant. */
export function logicalDatePickerValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value.slice(0, 10) : value;
}
