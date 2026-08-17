import { describe, expect, it } from "vitest";

import {
  buildAppViewHref,
  buildAppViewRecordHref,
  getAppViewCardMetadata,
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
      "Flujo",
      "Tablero",
      "Dashboard",
    ]);
  });

  it("builds human AppView card metadata without leaking technical ids", () => {
    const recordsView = appViewsFixture.find((view) => view.type === "RECORDS");

    expect(recordsView).toBeTruthy();
    expect(getAppViewCardMetadata(recordsView!)).toBe("Registros");
    expect(getAppViewCardMetadata(recordsView!)).not.toContain(recordsView!.config.entityTypeId);
  });
});
