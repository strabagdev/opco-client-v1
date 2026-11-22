export const MIN_WEB_TEXT_INPUT_FONT_SIZE = 16;
export const STABLE_ACTION_BUTTON_MIN_HEIGHT = 44;
export const STABLE_PRIMARY_BUTTON_MIN_WIDTH = 112;
export const STABLE_LOAD_MORE_BUTTON_MIN_WIDTH = 144;

export const stableTextInputStyle = {
  fontSize: MIN_WEB_TEXT_INPUT_FONT_SIZE,
} as const;

// Keep manual entry independent of the width of an optional scanner action.
// Explicit width also avoids relying on intrinsic sizing of a flexed text input.
export const manualSearchControlsStyle = {
  alignItems: "stretch",
  flexDirection: "column",
  gap: 8,
  minWidth: 0,
  width: "100%",
} as const;

export const manualSearchInputLayout = {
  minWidth: 0,
  width: "100%",
} as const;

export const stableSubmitButtonStyle = {
  minHeight: STABLE_ACTION_BUTTON_MIN_HEIGHT,
  minWidth: STABLE_PRIMARY_BUTTON_MIN_WIDTH,
} as const;
