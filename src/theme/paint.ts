import { Platform } from "react-native";
import { borderWidth, focusOffset, themes, type ThemeColors } from "./tokens";

/** Web paint is reactive through CSS, without remounting consumers or their data effects. */
export const colors: ThemeColors = Platform.OS === "web"
  ? Object.fromEntries(Object.entries(themes.light).map(([role, fallback]) => [role, `var(--opco-${role}, ${fallback})`])) as ThemeColors
  : themes.light;
export const focusStyle = { outlineColor: colors.focus, outlineWidth: borderWidth.focus, outlineStyle: "solid", outlineOffset: focusOffset } as const;
