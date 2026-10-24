import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StateUpdateFormGrid, StateUpdateReadRows, stateUpdateReadColumns, type StateUpdateReadRow } from "./state-update-presentation";

const viewport = vi.hoisted(() => ({ width: 1440, height: 900, scale: 1, fontScale: 1 }));
vi.mock("react-native", async () => ({ ...await import("react-native-web"), useWindowDimensions: () => viewport }));

const rows: StateUpdateReadRow[] = [
  { key: "remote-a", name: "Sujeto de nombre largo", values: [
    { fieldId: "number", label: "Dato", value: "0" }, { fieldId: "boolean", label: "Dato", value: "No" },
    { fieldId: "historical", label: "Etiqueta histórica", value: "2026-10-24" },
  ] },
  { key: "remote-b", name: "Segundo sujeto", values: [{ fieldId: "number", label: "Dato", value: "14.5" }], onPress: vi.fn() },
];
describe("STATE_UPDATE reading and form presentation", () => {
  it("keeps configured and historical fields distinct by ID without mutating or dropping empty/zero values", () => {
    const before = JSON.stringify(rows);
    expect(stateUpdateReadColumns(rows)).toEqual(["number", "boolean", "historical"]);
    const html = renderToStaticMarkup(<StateUpdateReadRows rows={rows} />);
    for (const value of ["Sujeto de nombre largo", "Segundo sujeto", "Etiqueta histórica", "2026-10-24", ">0<", ">No<", "14.5"]) expect(html).toContain(value);
    expect(JSON.stringify(rows)).toBe(before);
    expect(rows[1].onPress).not.toHaveBeenCalled();
    expect(html).toContain('aria-label="Segundo sujeto"');
  });
  it("retains the compact summary and uncertainty message on mobile, without inventing a current event", () => {
    viewport.width = 390;
    try {
      const html = renderToStaticMarkup(<StateUpdateReadRows rows={[
        { key: "subject", name: "Sujeto", values: rows[0].values, compactText: "0 · No · 24-10-2026" },
        { key: "unverified", name: "Otro", values: [], compactText: "Reporte no verificado sin conexión", fallback: "Reporte no verificado sin conexión" },
      ]} />);
      expect(html).toContain("0 · No · 24-10-2026");
      expect(html).toContain("Reporte no verificado sin conexión");
      expect(html).not.toContain("Etiqueta histórica");
    } finally { viewport.width = 1440; }
  });
  it("does not turn informational latest rows into actions", () => {
    const html = renderToStaticMarkup(<StateUpdateReadRows rows={[rows[0]]} />);
    expect(html).not.toContain('role="button"');
  });
  it("keeps actual controls and optional long content present in the same form", () => {
    const html = renderToStaticMarkup(<StateUpdateFormGrid slots={[
      { key: "date", content: <input aria-label="Fecha" type="date" required defaultValue="2026-10-24" /> },
      { key: "option", content: <select aria-label="Opción" defaultValue="stable-id"><option value="stable-id">Etiqueta</option></select> },
      { key: "note", full: true, content: <textarea aria-label="Observación" defaultValue="Borrador conservado" /> },
    ]} />);
    expect(html).toContain('value="2026-10-24"'); expect(html).toContain('value="stable-id"');
    expect(html).toContain("Borrador conservado"); expect(html).toContain('required=""');
  });
});
