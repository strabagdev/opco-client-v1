import { describe, expect, it } from "vitest";
import { getHomeGridLayout } from "./app-shell-layout";

describe("Home responsive grid", () => {
  it.each([
    [390, 1, 20, 10, 350],
    [768, 2, 20, 16, 356],
    [899, 2, 20, 16, 421.5],
    [900, 2, 24, 16, 418],
    [1024, 2, 24, 16, 480],
    [1199, 2, 24, 16, 567.5],
    [1200, 3, 24, 16, 1120 / 3],
    [1440, 3, 24, 16, 400],
  ])("at %d preserves column widths and breakpoint boundaries", (width, columns, padding, gap, cardWidth) => {
    expect(getHomeGridLayout(width)).toEqual({ columns, padding, gap, cardWidth });
  });

  it("keeps a single column when a tablet content area cannot fit two useful cards", () => {
    expect(getHomeGridLayout(1024, 300)).toEqual({ columns: 1, padding: 24, gap: 16, cardWidth: 300 });
  });

  it("uses measured content width, including scrollbar space, without stretching the last row", () => {
    const result = getHomeGridLayout(1024, 961);
    expect(result.columns).toBe(2);
    expect(result.cardWidth * result.columns + result.gap).toBe(961);
  });
});
