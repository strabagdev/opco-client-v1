import { describe, expect, it } from "vitest";

import {
  MIN_WEB_TEXT_INPUT_FONT_SIZE,
  STABLE_ACTION_BUTTON_MIN_HEIGHT,
  STABLE_PRIMARY_BUTTON_MIN_WIDTH,
  stableSubmitButtonStyle,
  stableTextInputStyle,
} from "./visual-stability";

describe("visual stability", () => {
  it("keeps editable text inputs large enough to avoid mobile WebKit auto zoom", () => {
    expect(MIN_WEB_TEXT_INPUT_FONT_SIZE).toBeGreaterThanOrEqual(16);
    expect(stableTextInputStyle.fontSize).toBeGreaterThanOrEqual(16);
  });

  it("keeps submit buttons at stable critical dimensions while loading", () => {
    expect(STABLE_ACTION_BUTTON_MIN_HEIGHT).toBeGreaterThanOrEqual(44);
    expect(STABLE_PRIMARY_BUTTON_MIN_WIDTH).toBeGreaterThanOrEqual(110);
    expect(stableSubmitButtonStyle).toMatchObject({
      minHeight: STABLE_ACTION_BUTTON_MIN_HEIGHT,
      minWidth: STABLE_PRIMARY_BUTTON_MIN_WIDTH,
    });
  });

  it("does not put transform scale in shared loading or input styles", () => {
    expect(stableTextInputStyle).not.toHaveProperty("transform");
    expect(stableSubmitButtonStyle).not.toHaveProperty("transform");
  });
});
