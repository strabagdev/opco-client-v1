import { useId } from "react";
import { Platform } from "react-native";

/** Presentation IDs only. Never use these generated IDs as field or record identity. */
export type FieldAccessibility = {
  controlId?: string;
  labelledBy?: string;
  describedBy?: string;
  invalid?: boolean;
};

export function useFieldAccessibility(label: string, error?: string, required?: boolean) {
  const id = useId();
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const accessibility: FieldAccessibility = {
    controlId: `${id}-control`, labelledBy: labelId,
    describedBy: error ? errorId : undefined, invalid: Boolean(error),
  };
  return {
    labelId, errorId, accessibility,
    controlProps: {
      nativeID: accessibility.controlId,
      accessibilityLabel: label,
      "aria-labelledby": labelId,
      ...(Platform.OS === "web" ? { "aria-describedby": accessibility.describedBy, "aria-invalid": Boolean(error), "aria-required": required } : {}),
    },
  };
}
