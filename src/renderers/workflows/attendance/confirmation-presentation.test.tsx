import { actionSurface } from "../../../theme/operational-presentation";
import { colors } from "../../../theme/tokens";
// @ts-expect-error Node types are intentionally absent from Expo config.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Pressable, ScrollView, Text, View } from "react-native";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { formatDisplayDate } from "./attendance-workflow-logic";
vi.mock("react-native", async () => import("react-native-web"));

const path = "src/renderers/workflows/attendance/AttendanceWorkflow.tsx";
const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let declaration: ts.FunctionDeclaration | undefined;
function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "ConflictModal") declaration = node; ts.forEachChild(node, visit); }
visit(source);
const code = ts.transpileModule(declaration!.getText(source), { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;

describe("actual confirmation content", () => {
  it.each([390, 1024, 1440])("shows note-only correction and captured values at %s without executing actions", width => {
    const styles = {};
    // Modal portals cannot render on the server; retain its real children for this content check.
    const context = { actionSurface, colors, React, Text, View, Pressable, ScrollView, Modal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useWindowDimensions: () => ({ width }), APP_SHELL_WIDE_BREAKPOINT: 900, desktopStyles: styles, baseStyles: styles, formatDisplayDate };
    const Component = new Function(...Object.keys(context), `${code}; return ConflictModal;`)(...Object.values(context));
    const confirm = vi.fn(), cancel = vi.fn();
    const html = renderToStaticMarkup(<Component experienceName="Experiencia configurada" date="2026-11-08" isSaving={false} error="Petición rechazada; edición conservada"
      conflict={{ personName: "Sujeto sintético" }} rows={[
        { label: "Estado", current: "A", requested: "A", changed: false },
        { label: "Observación", current: "Antes", requested: "Después", changed: true },
        { label: "Referencia", current: "Catálogo uno", requested: "Catálogo dos", changed: true },
      ]} onConfirm={confirm} onCancel={cancel} />);
    for (const text of ["Experiencia configurada", "Corregir registro existente", "no se creará uno nuevo", "Sin cambios", "Se modificará", "Antes", "Después", "Catálogo dos", "Confirmar corrección", "Cancelar", "Petición rechazada; edición conservada"]) expect(html).toContain(text);
    expect(html).toContain('role="alert"');
    expect(confirm).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
  });
});
