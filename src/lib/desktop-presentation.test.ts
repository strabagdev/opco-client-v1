import { describe, expect, it, vi } from "vitest";
import { colors } from "../theme/paint";
import { desktopStyleColors } from "./desktop-presentation";
vi.mock("react-native", () => ({ Platform: { OS: "web" }, StyleSheet: { create: (value: unknown) => value } }));

describe("scoped desktop presentation", () => {
  it("changes paint only without mutating mobile styles or semantic states", () => {
    const source = { control: { color: "#17363c", backgroundColor: "#135d66", minHeight: 48, padding: 18 }, success: { color: "#067647" }, warning: { color: "#9a3412", backgroundColor: "#fff7ed" }, error: { color: "#b42318" } };
    const before = JSON.stringify(source);
    const desktop = desktopStyleColors(source);
    expect(desktop.control).toEqual({ color: colors.text, backgroundColor: colors.primary, minHeight: 48, padding: 18 });
    expect(desktop.control.color).toBe("var(--opco-text, #202B3A)");
    expect(desktop.control.backgroundColor).toBe("var(--opco-primary, #315DA8)");
    expect(desktop.success).toEqual(source.success);
    expect(desktop.warning).toEqual(source.warning);
    expect(desktop.error).toEqual(source.error);
    expect(JSON.stringify(source)).toBe(before);
  });
});
