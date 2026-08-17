import { describe, expect, it } from "vitest";

import {
  buildAppViewHref,
  buildAppViewRecordHref,
  getAppViewTypeLabel,
  sortAppViews,
} from "./app-views";
import { appViewsFixture } from "../test/fixtures";

describe("app views", () => {
  it("orders assigned views by sortOrder", () => {
    expect(sortAppViews(appViewsFixture).map((view) => view.id)).toEqual([
      "view_workflow",
      "view_records",
      "view_board",
      "view_dashboard",
    ]);
  });

  it("builds navigation hrefs from AppView ids instead of EntityType ids", () => {
    expect(buildAppViewHref("view_records")).toBe("/view/view_records");
    expect(buildAppViewRecordHref("view_records", "record_1")).toBe("/view/view_records/record/record_1");
  });

  it("recognizes all current AppView types", () => {
    expect(appViewsFixture.map((view) => getAppViewTypeLabel(view.type))).toEqual([
      "Registros",
      "Workflow",
      "Tablero",
      "Dashboard",
    ]);
  });
});
