import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";

// Scoped presentation tokens, never a global/native/mobile theme override.
export const desktopPalette = {
  background: "#F4F6F8", surface: "#FFFFFF", sidebar: "#18263A",
  primary: "#315DA8", selection: "#E8EFFA", text: "#202B3A",
  muted: "#536174", border: "#DCE2EA", controlBorder: "#7B879A",
  sidebarText: "#E5EAF2", organization: "#B7C6DC", hover: "#22334D",
  active: "#263F64", activeMark: "#90B8FF", sidebarFocus: "#A8C7FF",
} as const;

const oldColors: Record<string, string> = {
  "#eef4f4": desktopPalette.background, "#f8fbfb": desktopPalette.surface,
  "#e4f1f2": desktopPalette.selection, "#17363c": desktopPalette.text,
  "#0f3036": desktopPalette.text, "#135d66": desktopPalette.primary,
  "#587078": desktopPalette.muted, "#64757b": desktopPalette.muted,
  "#2f5e66": desktopPalette.muted, "#edf6f6": desktopPalette.background,
  "#d7e4e7": desktopPalette.border, "#c8d8dc": desktopPalette.border,
  "#b7cdd2": desktopPalette.controlBorder, "#d4dddf": desktopPalette.border,
  "#c8d2d5": desktopPalette.controlBorder, "#dceff1": desktopPalette.selection,
};

// Paint existing styles without changing semantics, metrics or functional components.
export function desktopStyleColors<T extends Record<string, ViewStyle | TextStyle>>(styles: T): T {
  return StyleSheet.create(Object.fromEntries(Object.entries(styles).map(([key, style]) => [key,
    Object.fromEntries(Object.entries(style).map(([property, value]) => [property,
      typeof value === "string" && property.toLowerCase().includes("color") ? oldColors[value] ?? value : value,
    ])),
  ])) as T);
}
