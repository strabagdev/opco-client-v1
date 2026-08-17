export const MIN_WEB_TEXT_INPUT_FONT_SIZE = 16;
export const STABLE_ACTION_BUTTON_MIN_HEIGHT = 44;
export const STABLE_PRIMARY_BUTTON_MIN_WIDTH = 112;
export const STABLE_LOAD_MORE_BUTTON_MIN_WIDTH = 144;

export const stableTextInputStyle = {
  fontSize: MIN_WEB_TEXT_INPUT_FONT_SIZE,
} as const;

export const stableSubmitButtonStyle = {
  minHeight: STABLE_ACTION_BUTTON_MIN_HEIGHT,
  minWidth: STABLE_PRIMARY_BUTTON_MIN_WIDTH,
} as const;
