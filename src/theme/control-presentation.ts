import type { CSSProperties } from "react";
import { Platform } from "react-native";
import { borderWidth, focusOffset, metrics, radii, space, systemFontFamilyWeb, typography, type ThemeColors } from "./tokens";
import { colors } from "./paint";

/** Paint only. Callers own values, permission, disabled state and handlers. */
export function actionColors(primary: boolean, state: { disabled?: boolean; pressed?: boolean; hovered?: boolean }, palette: ThemeColors = colors) {
  if (state.disabled) return { backgroundColor: palette.disabled, color: palette.onDisabled, borderColor: palette.disabledBorder };
  return { backgroundColor: primary ? state.pressed ? palette.primaryPressed : state.hovered ? palette.primaryHover : palette.primary : state.pressed ? palette.secondaryPressed : state.hovered ? palette.secondaryHover : palette.secondary,
    color: primary ? palette.onPrimary : palette.onSecondary, borderColor: primary ? state.pressed ? palette.primaryPressed : state.hovered ? palette.primaryHover : palette.primary : palette.controlBorder };
}
export function fieldColors(disabled?: boolean, invalid?: boolean, palette: ThemeColors = colors) {
  return { backgroundColor: disabled ? palette.disabled : palette.surface, color: disabled ? palette.onDisabled : palette.text,
    borderColor: disabled ? palette.disabledBorder : invalid ? palette.danger : palette.controlBorder };
}
export const controlText = { ...typography.control, ...(Platform.OS === "web" ? { fontFamily: systemFontFamilyWeb } : {}) };
export const controlFrame = { borderWidth: borderWidth.line, borderRadius: radii.control, minHeight: metrics.controlMinHeight, paddingHorizontal: space.md };
export function webFieldStyle(disabled?: boolean, invalid?: boolean, focused?: boolean): CSSProperties {
  return { ...fieldColors(disabled, invalid), borderStyle: "solid", borderWidth: borderWidth.line, borderRadius: radii.control,
    minHeight: metrics.controlMinHeight, padding: `${space.sm}px ${space.md}px`, fontFamily: systemFontFamilyWeb,
    fontSize: typography.control.fontSize, lineHeight: `${typography.control.lineHeight}px`, fontWeight: typography.control.fontWeight,
    minWidth: 0, width: "100%", maxWidth: "100%", boxSizing: "border-box", colorScheme: "inherit",
    outline: focused && !disabled ? `${borderWidth.focus}px solid ${colors.focus}` : undefined, outlineOffset: focusOffset };
}
