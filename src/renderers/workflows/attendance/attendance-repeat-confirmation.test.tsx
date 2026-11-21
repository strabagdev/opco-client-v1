// @ts-expect-error Node types intentionally absent from the Expo app configuration.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Modal, Pressable, Text, View } from "react-native";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as confirmation from "./attendance-confirmation";
import { formatDisplayDate } from "./attendance-workflow-logic";

vi.mock("react-native", async () => import("react-native-web"));

const source = ts.createSourceFile("AttendanceWorkflow.tsx", readFileSync(
  `${process.cwd()}/src/renderers/workflows/attendance/AttendanceWorkflow.tsx`, "utf8",
), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let dialog: ts.JsxElement | undefined;
function visit(node: ts.Node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "Modal" &&
      node.openingElement.attributes.getText(source).includes("cancelRepeatedRecord")) dialog = node;
  ts.forEachChild(node, visit);
}
visit(source);
if (!dialog) throw Error("Missing existing repeat confirmation dialog");
const code = ts.transpileModule(`function Content(){return (${dialog.getText(source)});}`, {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
}).outputText;

function renderWarning(localCount: number, remoteCount?: number, saving = false, visible = true) {
  const confirm = vi.fn(), cancel = vi.fn();
  const presses: React.ComponentProps<typeof Pressable>[] = [];
  let close: React.ComponentProps<typeof Modal>["onRequestClose"];
  const date = "2030-04-15";
  const repeatWarning = visible ? { localCount, remoteCount } : null;
  const context = {
    React, Text, View,
    Pressable: (props: React.ComponentProps<typeof Pressable>) => { presses.push(props); return <Pressable {...props} />; },
    Modal: (props: React.ComponentProps<typeof Modal>) => { close = props.onRequestClose; return props.visible ? <div role="dialog">{props.children}</div> : null; },
    styles: {}, isSaving: saving, date, repeatWarning, formatDisplayDate,
    repeatConfirmation: repeatWarning && confirmation.attendanceRepeatConfirmationPresentation
      ? confirmation.attendanceRepeatConfirmationPresentation({ ...repeatWarning, dateLabel: formatDisplayDate(date) }) : null,
    cancelRepeatedRecord: cancel, confirmRepeatedRecord: confirm,
  };
  const Content = new Function(...Object.keys(context), `${code};return Content;`)(...Object.values(context));
  const html = renderToStaticMarkup(<Content />);
  return { html, confirm, cancel, presses, close: () => close?.({} as never) };
}

describe("existing Attendance confirmation dialog", () => {
  it("projects only wording without modifying a captured confirmation", () => {
    const input = Object.freeze({ localCount: 0, dateLabel: "Fecha elegida", entry: Object.freeze({ context: "original", eventOccurredAt: null }) });
    const before = JSON.stringify(input);
    expect(confirmation.attendanceRepeatConfirmationPresentation(input).confirmLabel).toBe("Confirmar registro");
    expect(JSON.stringify(input)).toBe(before);
  });
  it("calls a zero-local offline operation a record, explicitly leaves the server count unknown", () => {
    const { html, confirm, cancel } = renderWarning(0);
    expect(html).toContain("Confirmar registro");
    expect(html).not.toContain("adicional");
    expect(html).toContain("No hay registros de esta persona");
    expect(html).toContain("guardados en este dispositivo");
    expect(html.split("Sin conexión no se puede comprobar si existen otros registros en el servidor.")).toHaveLength(2);
    expect(confirm).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each([1, 3])("describes %s locally available records without claiming a complete remote count", count => {
    const { html } = renderWarning(count);
    expect(html).toContain(count === 1 ? "1 registro disponible" : "3 registros disponibles");
    expect(html).toContain("Confirmar uno adicional");
    expect(html).toContain("Sin conexión no se puede comprobar si existen otros registros en el servidor.");
  });

  it("keeps a verified remote count distinct from zero local records", () => {
    const { html } = renderWarning(0, 2);
    expect(html).toContain("Opco informa 2 registros");
    expect(html).toContain("0 registros disponibles localmente");
    expect(html).toContain("Confirmar uno adicional");
    expect(html).not.toContain("Sin conexión no se puede");
  });

  it("keeps local pending records visible even when the verified server count is zero", () => {
    const { html } = renderWarning(1, 0);
    expect(html).toContain("Opco informa 0 registros");
    expect(html).toContain("1 registro disponible localmente");
    expect(html).toContain("Confirmar uno adicional");
  });

  it("retains the existing confirm, cancel and platform-dismiss handlers", () => {
    const { presses, confirm, cancel, close } = renderWarning(0);
    expect(presses).toHaveLength(2);
    presses[1].onPress?.({} as never);
    expect(confirm).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    presses[0].onPress?.({} as never);
    close();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("keeps confirm disabled while saving and renders no dialog without a pending confirmation", () => {
    expect(renderWarning(0, undefined, true).presses[1].disabled).toBe(true);
    expect(renderWarning(0, undefined, false, false).html).toBe("");
  });
});
