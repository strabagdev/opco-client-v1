import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PanelFilterConfig } from "../../lib/opco-api";
import { missingRequiredPanelFilters, normalizePanelFilters } from "./panel-renderer-logic";
import { initialPanelFilterInputs, usePanelFilterInputs } from "./use-panel-filter-inputs";

const filters: PanelFilterConfig[] = [
  { id: "date", valueType: "DATE", required: true, defaultValue: { type: "TODAY", timeZone: "America/Santiago" } },
  { id: "lot", valueType: "RECORD" },
];

describe("PANEL dynamic TODAY", () => {
  it.each([
    ["2026-11-18T01:00:00Z", "2026-11-17"],
    ["2026-07-02T03:30:00Z", "2026-07-01"],
    ["2026-01-02T03:30:00Z", "2026-01-02"],
    ["2026-09-06T03:59:59Z", "2026-09-05"],
    ["2026-09-06T04:00:00Z", "2026-09-06"],
    ["2026-04-05T02:59:59Z", "2026-04-04"],
    ["2026-04-05T03:00:00Z", "2026-04-04"],
    ["2026-04-05T04:00:00Z", "2026-04-05"],
    ["2028-03-01T02:00:00Z", "2028-02-29"],
  ])("uses the configured calendar date at %s", (instant, expected) => {
    expect(initialPanelFilterInputs(filters, new Date(instant))).toEqual({ date: expected });
  });

  it("supports other zones without contract or experience conditions", () => {
    const now = new Date("2026-11-18T01:00:00Z");
    expect(initialPanelFilterInputs([{ ...filters[0], defaultValue: { type: "TODAY", timeZone: "Asia/Tokyo" } }], now)).toEqual({ date: "2026-11-18" });
    expect(initialPanelFilterInputs([{ ...filters[0], defaultValue: { type: "TODAY", timeZone: "UTC" } }], now)).toEqual({ date: "2026-11-18" });
  });

  it.each(["Mars/Olympus", "", "+03:00"])("does not substitute device/UTC for invalid zone %s", timeZone => {
    const invalid = [{ ...filters[0], defaultValue: { type: "TODAY" as const, timeZone } }];
    const values = initialPanelFilterInputs(invalid);
    expect(values).toEqual({});
    expect(missingRequiredPanelFilters(invalid, { filters: [{ type: "PANEL_FILTER", filterId: "date", fieldId: "business-date", operator: "EQ" }] } as never, values)).toHaveLength(1);
  });

  it("keeps legacy filters and non-DATE controls empty", () => {
    expect(initialPanelFilterInputs([{ id: "date", valueType: "DATE" }, filters[1]])).toEqual({});
    expect(initialPanelFilterInputs([{ ...filters[0], valueType: "TEXT" }])).toEqual({});
  });

  it("resolves once into the concrete selection shared by metrics, detail and snapshot key", () => {
    const initial = initialPanelFilterInputs(filters, new Date("2026-11-18T01:00:00Z"));
    expect(normalizePanelFilters(filters, initial)).toEqual({ date: "2026-11-17" });
    expect(normalizePanelFilters(filters, { ...initial, date: "2026-11-15", lot: "synthetic-lot" })).toEqual({ date: "2026-11-15", lot: "synthetic-lot" });
    expect(normalizePanelFilters(filters, { ...initial, date: "" })).toEqual({});
  });

  it("the real input hook exposes today's DATE on its first render", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T01:00:00Z"));
    try {
      function Probe() {
        const state = usePanelFilterInputs({ filters, scopeKey: "synthetic-owner:contract:view:revision" });
        return <input type="date" value={state.values.date ?? ""} readOnly />;
      }
      expect(renderToStaticMarkup(<Probe />)).toContain('value="2026-11-17"');
    } finally { vi.useRealTimers(); }
  });
});
