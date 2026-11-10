/** Approved pure visual contract v1. Web bindings and preference live separately. */
export const themeVersion = 1;
export const themes = {
  "light": {
    "canvas": "#F4F6F8",
    "surface": "#FFFFFF",
    "surfaceRaised": "#FFFFFF",
    "surfaceSubtle": "#EAF0F6",
    "surfaceAlternate": "#F6F8FB",
    "text": "#202B3A",
    "textSecondary": "#536174",
    "textQuiet": "#5F6E82",
    "border": "#DCE2EA",
    "controlBorder": "#7B879A",
    "primary": "#315DA8",
    "onPrimary": "#FFFFFF",
    "primaryHover": "#274D8C",
    "primaryPressed": "#203F75",
    "secondary": "#FFFFFF",
    "onSecondary": "#315DA8",
    "secondaryHover": "#E8EFFA",
    "secondaryPressed": "#D8E5F8",
    "selection": "#E8EFFA",
    "onSelection": "#203F75",
    "selectionBorder": "#315DA8",
    "focus": "#315DA8",
    "focusOnNavigation": "#A8C7FF",
    "disabled": "#E5EAF1",
    "onDisabled": "#536174",
    "disabledBorder": "#A7B4C6",
    "nav": "#18263A",
    "onNav": "#E5EAF2",
    "navSecondary": "#B7C6DC",
    "navHover": "#22334D",
    "navSelected": "#263F64",
    "navMark": "#90B8FF",
    "info": "#235EA8",
    "infoSurface": "#EBF3FF",
    "infoBorder": "#3B6EB5",
    "success": "#176544",
    "successSurface": "#E8F5EE",
    "successBorder": "#2F8560",
    "warning": "#7A4700",
    "warningSurface": "#FFF4DB",
    "warningBorder": "#A56A10",
    "danger": "#B42318",
    "dangerSurface": "#FFF0EE",
    "dangerBorder": "#C5463B",
    "conflict": "#6337A3",
    "conflictSurface": "#F3ECFC",
    "conflictBorder": "#8660B6",
    "overlay": "rgba(16,27,45,0.48)",
    "shadowOverlay": "0 8px 24px rgba(16,27,45,0.14)"
  },
  "dark": {
    "canvas": "#101827",
    "surface": "#182235",
    "surfaceRaised": "#202D43",
    "surfaceSubtle": "#25354D",
    "surfaceAlternate": "#1D2940",
    "text": "#F1F5F9",
    "textSecondary": "#BDC9DA",
    "textQuiet": "#A5B3C8",
    "border": "#35455D",
    "controlBorder": "#7F91AE",
    "primary": "#9ABBFF",
    "onPrimary": "#102342",
    "primaryHover": "#B3CDFF",
    "primaryPressed": "#82ABF5",
    "secondary": "#182235",
    "onSecondary": "#B3CDFF",
    "secondaryHover": "#253D64",
    "secondaryPressed": "#2C4875",
    "selection": "#253D64",
    "onSelection": "#D6E6FF",
    "selectionBorder": "#91B7FA",
    "focus": "#A8C7FF",
    "focusOnNavigation": "#A8C7FF",
    "disabled": "#29354A",
    "onDisabled": "#A8B6CB",
    "disabledBorder": "#56657D",
    "nav": "#101B2D",
    "onNav": "#E5EAF2",
    "navSecondary": "#B7C6DC",
    "navHover": "#1B2A42",
    "navSelected": "#253D64",
    "navMark": "#A8C7FF",
    "info": "#A4CAFF",
    "infoSurface": "#1B304D",
    "infoBorder": "#7AA6D6",
    "success": "#8DDDB5",
    "successSurface": "#15352C",
    "successBorder": "#4C9D7C",
    "warning": "#FFD58A",
    "warningSurface": "#332A1C",
    "warningBorder": "#C49643",
    "danger": "#FFB4AB",
    "dangerSurface": "#3E2327",
    "dangerBorder": "#D77E7B",
    "conflict": "#D9C0FF",
    "conflictSurface": "#302440",
    "conflictBorder": "#A48CC8",
    "overlay": "rgba(0,0,0,0.64)",
    "shadowOverlay": "0 8px 24px rgba(0,0,0,0.4)"
  }
} as const;
export const space = {
  "none": 0,
  "hair": 2,
  "xs": 4,
  "sm": 8,
  "md": 12,
  "lg": 16,
  "field": 20,
  "section": 24,
  "xl": 32,
  "xxl": 40,
  "touch": 48,
  "page": 64
} as const;
export const radii = {
  "none": 0,
  "badge": 4,
  "control": 8,
  "section": 12
} as const;
export const borderWidth = {
  "line": 1,
  "focus": 3
} as const;
export const metrics = {
  "controlMinHeight": 44,
  "actionMinWidth": 112,
  "formMaxWidth": 960,
  "searchMaxWidth": 560,
  "iconSmall": 18,
  "iconControl": 20,
  "iconNavigation": 24,
  "iconStroke": 2
} as const;
export const systemFontFamilyWeb = "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif";
export const typography = {
  "body": {
    "fontSize": 16,
    "lineHeight": 24,
    "fontWeight": "400"
  },
  "control": {
    "fontSize": 16,
    "lineHeight": 24,
    "fontWeight": "400"
  },
  "label": {
    "fontSize": 14,
    "lineHeight": 20,
    "fontWeight": "600"
  },
  "table": {
    "fontSize": 14,
    "lineHeight": 20,
    "fontWeight": "400"
  },
  "meta": {
    "fontSize": 13,
    "lineHeight": 18,
    "fontWeight": "400"
  },
  "section": {
    "fontSize": 20,
    "lineHeight": 28,
    "fontWeight": "600"
  },
  "title": {
    "fontSize": 24,
    "lineHeight": 32,
    "fontWeight": "700"
  },
  "brand": {
    "fontSize": 28,
    "lineHeight": 36,
    "fontWeight": "700"
  }
} as const;
export const focusOffset = 2;
export type ThemeName = keyof typeof themes;
export type ThemeColors = { readonly [K in keyof typeof themes.light]: string };
// Legacy pure defaults stay light; web paint uses the separate CSS binding.
export const activeThemeName: ThemeName = "light";
export const colors = themes.light;
export const focusStyle = { outlineColor: colors.focus, outlineWidth: borderWidth.focus, outlineStyle: "solid", outlineOffset: focusOffset } as const;
