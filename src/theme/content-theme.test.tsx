// @ts-expect-error Node types are intentionally absent from Expo config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { StyleSheet } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { colors, metrics, themes, type ThemeColors } from "./tokens";
import { desktopStyleColors } from "../lib/desktop-presentation";
import { stableTextInputStyle, stableSubmitButtonStyle, STABLE_LOAD_MORE_BUTTON_MIN_WIDTH } from "../lib/visual-stability";
vi.mock("react-native", async () => import("react-native-web"));

/** Exercise actual paint factories without starting renderers, requests or session effects. */
function style(file: string, name: string, p: ThemeColors) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const code = source.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text.startsWith("create") && (/Styles$/.test(n.name.text) || ["createReadFieldS", "createStateReadS"].includes(n.name.text)))
    .map(n => n.getText(source).replace(/^export /, "")).join("\n");
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("StyleSheet", "colors", "metrics", "Platform", "desktopStyleColors", "stableTextInputStyle", "stableSubmitButtonStyle", "STABLE_LOAD_MORE_BUTTON_MIN_WIDTH", js + `; return ${name};`)
    (StyleSheet, colors, metrics, { OS: "web" }, desktopStyleColors, stableTextInputStyle, stableSubmitButtonStyle, STABLE_LOAD_MORE_BUTTON_MIN_WIDTH)(p);
}
function contrast(a: string, b: string) {
  const lum = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const values = [lum(a), lum(b)].sort((x, y) => x - y); return (values[1] + .05) / (values[0] + .05);
}
const root = "src/renderers/";
describe("configured content paint, light active and dark prepared", () => {
  it.each(["light", "dark"] as const)("applies actual content roles and contrast in %s", theme => {
    const p = themes[theme], pairs: [string, string][] = [];
    const records = style(root + "records/RecordsRenderer.tsx", "createRecordsNoticeStyles", p);
    expect(records.screen.backgroundColor).toBe(p.canvas); expect(records.title.color).toBe(p.text);
    expect(records.searchInput).toMatchObject({ backgroundColor: p.surface, borderColor: p.controlBorder, color: p.text });
    pairs.push([records.title.color, records.screen.backgroundColor], [records.createText.color, records.createButton.backgroundColor], [records.loadMoreText.color, records.loadMoreButton.backgroundColor]);
    const detail = style(root + "records/RecordDetailScreen.tsx", "createRecordDetailNoticeStyles", p);
    const read = style("src/components/read-field-list.tsx", "createReadFieldS", p);
    pairs.push([detail.title.color, detail.screen.backgroundColor], [read.value.color, p.surface], [read.label.color, p.surface], [read.unavailable.color, p.surface]);
    for (const factory of ["createAttendanceBaseStyles", "createAttendanceDesktopStyles"]) {
      const s = style(root + "workflows/attendance/AttendanceWorkflow.tsx", factory, p);
      expect(s.screen.backgroundColor).toBe(p.canvas); expect(s.primaryStatusButton.backgroundColor).toBe(p.primary);
      pairs.push([s.personName.color, s.checkInPanel.backgroundColor], [s.primaryStatusText.color, s.primaryStatusButton.backgroundColor], [s.contextLabel.color, p.surface]);
    }
    const state = style(root + "workflows/state-update/StateUpdateWorkflow.tsx", "createStateUpdateBaseStyles", p);
    pairs.push([state.subjectName.color, state.subjectRow.backgroundColor], [state.primaryText.color, state.primaryButton.backgroundColor], [state.conflictLabel.color, state.conflictListRow.backgroundColor]);
    const panel = style(root + "panels/PanelRenderer.tsx", "createPanelTableStyles", p);
    expect(panel.headerRow.backgroundColor).toBe(p.surfaceSubtle); expect(panel.pagination.backgroundColor).toBe(p.surface);
    pairs.push([panel.value.color, p.surface], [panel.headerCell.color, panel.headerRow.backgroundColor], [panel.pageButtonText.color, panel.pageButton.backgroundColor]);
    const table = style(root + "reports/ReportRenderer.tsx", "createReportTableStyles", p);
    expect(table.headerRow.backgroundColor).toBe(p.surfaceSubtle); pairs.push([table.value.color, p.surface], [table.headerCell.color, table.headerRow.backgroundColor]);
    const matrix = style(root + "reports/ReportRenderer.tsx", "createReportMatrixStyles", p);
    expect(matrix.rowLabel.backgroundColor).toBe(p.surface); expect(matrix.headerCell.backgroundColor).toBe(p.surfaceSubtle);
    expect(matrix.summary.backgroundColor).toBe(p.surfaceSubtle); expect(matrix.alternateRow.backgroundColor).toBe(p.surfaceAlternate);
    pairs.push([matrix.cell.color, matrix.row.backgroundColor], [matrix.cell.color, matrix.alternateRow.backgroundColor], [matrix.cell.color, matrix.summary.backgroundColor], [matrix.headerCell.color, matrix.headerCell.backgroundColor]);
    const subject = style("src/components/subject-identity.tsx", "createSubjectIdentityStyles", p);
    pairs.push([subject.title.color, p.surface], [subject.secondary.color, p.surface], [subject.issue.color, p.surface]);
    for (const [foreground, background] of pairs) expect(contrast(foreground, background), `${theme}: ${foreground} / ${background}`).toBeGreaterThanOrEqual(4.5);
    expect(pairs).toHaveLength(28);
  });
  it("keeps matrix geometry and cell identity independent of palette", () => {
    const a = style(root + "reports/ReportRenderer.tsx", "createReportMatrixStyles", themes.light);
    const b = style(root + "reports/ReportRenderer.tsx", "createReportMatrixStyles", themes.dark);
    for (const key of Object.keys(a)) {
      const metricsOnly = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([k]) => !/color/i.test(k)));
      expect(metricsOnly(a[key])).toEqual(metricsOnly(b[key]));
    }
    expect(a.summary.width).toBe(220); expect(a.cell.minHeight).toBe(44); expect(a.valueCell.fontVariant).toEqual(["tabular-nums"]);
  });
});

it("paints the actual focused MATRIX viewport without changing zero, axes or values", async () => {
  const React = await import("react"), { renderToStaticMarkup } = await import("react-dom/server");
  const native = await import("react-native-web");
  const file = root + "reports/ReportRenderer.tsx", source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "ReportMatrix")!;
  const js = ts.transpileModule(node.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const matrix = Object.freeze({ columns: Object.freeze([{ key: "column", label: "Columna extensa" }]), rows: Object.freeze([{ id: "row", label: "Sujeto sintético", values: Object.freeze({ column: "0" }), summary: "Resumen conservado" }]) });
  const before = JSON.stringify(matrix);
  for (const p of Object.values(themes)) {
    const deps = { React, ...native, Platform: { OS: "web" }, useState: (initial: unknown) => [typeof initial === "boolean" ? true : 390, vi.fn()], colors: p, matrixStyles: style(file, "createReportMatrixStyles", p), styles: {} };
    const Matrix = new Function(...Object.keys(deps), js + ";return ReportMatrix;")(...Object.values(deps));
    const html = renderToStaticMarkup(React.createElement(Matrix, { matrix }));
    expect(html).toContain(`outline:3px solid ${p.focus}`); expect(html).toContain("position:sticky");
    expect(html).toContain("Sujeto sintético, Columna extensa: 0"); expect(html).toContain("Resumen conservado");
    expect(JSON.stringify(matrix)).toBe(before);
  }
});
