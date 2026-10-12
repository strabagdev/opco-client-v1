import { describe, expect, it } from "vitest";
import { appViewsFixture } from "../test/fixtures";
import { categoryHref, desktopNavigation, scopedDesktopCatalog } from "./desktop-navigation";
import { selectContractId } from "./contract-selection";
import { getDesktopSidebarWidth } from "./app-shell-layout";

describe("desktop navigation uses only the assigned catalog", () => {
  it("does not introduce unassigned views or empty categories", () => {
    const views = appViewsFixture.filter(view => view.type === "WORKFLOW");
    const result = desktopNavigation(views, "/", "workflows");
    expect(result.sections.map(section => section.id)).toEqual(["workflows"]);
    expect(result.selectedCategory).toBe("workflows");
    expect(result.sections.flatMap(section => section.cards.map(card => card.appView))).toEqual(views);
  });
  it("retains the active category for direct and nested experience links", () => {
    const view = appViewsFixture.find(view => view.type === "WORKFLOW")!;
    for (const suffix of ["", "/problems", "/record/record-id/conflict"]) {
      expect(desktopNavigation(appViewsFixture, `/view/${view.id}${suffix}`, "records").active).toBe("workflows");
    }
    expect(desktopNavigation([], `/view/${view.id}`, "workflows").active).toBeNull();
  });
  it("uses the existing experience destinations and category route params", () => {
    expect(categoryHref("records")).toEqual({ pathname: "/", params: { category: "records" } });
    const result = desktopNavigation(appViewsFixture, "/", "records");
    expect(result.active).toBe("records");
    expect(result.sections.find(section => section.id === "records")!.cards[0].href).toContain("/view/");
    expect(desktopNavigation(appViewsFixture, "/", "invented").selectedCategory).toBeNull();
  });
  it("never reuses a catalog across user or contract changes", () => {
    const catalog = { scope: JSON.stringify(["owner-a", "contract-a"]), views: appViewsFixture };
    expect(scopedDesktopCatalog(catalog, "owner-a", "contract-a")).toBe(appViewsFixture);
    expect(scopedDesktopCatalog(catalog, "owner-b", "contract-a")).toEqual([]);
    expect(scopedDesktopCatalog(catalog, "owner-a", "contract-b")).toEqual([]);
    expect(scopedDesktopCatalog(null, "owner-a", "contract-a")).toEqual([]);
  });
  it("keeps existing contract selection rules", () => {
    const contracts = [{ id: "c1", name: "Contrato con nombre largo", role: "ADMIN" as const }, { id: "c2", name: "Segundo contrato", role: "MEMBER" as const }];
    expect(selectContractId(contracts, "c2")).toBe("c2");
    expect(selectContractId(contracts, "unassigned")).toBeNull();
  });
  it.each([[390, 0], [899, 0], [900, 224], [1024, 224], [1199, 224], [1200, 264], [1440, 264]])("at %d keeps a stable shell and reserves %d pixels", (width, sidebar) => {
    expect(getDesktopSidebarWidth(width)).toBe(sidebar);
  });
});
