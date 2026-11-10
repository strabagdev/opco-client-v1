import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FieldFrame } from "./field-frame";
import { FormAction, FormActions } from "./form-actions";
import { FormLayout, FormGrid } from "./form-layout";
vi.mock("react-native", async () => import("react-native-web"));

describe("shared form composition keeps control ownership", () => {
  it("keeps a control bound to the supplied label, help and error once", () => {
    const html = renderToStaticMarkup(<FieldFrame label="Campo largo configurado" labelId="label" required description="Ayuda existente" descriptionId="help" error="Revisa el valor" errorId="error">
      <input aria-labelledby="label" aria-describedby="help error" aria-invalid="true" value="00001" readOnly />
    </FieldFrame>);
    expect(html).toContain('id="label"'); expect(html).toContain('id="help"'); expect(html).toContain('id="error"'); expect(html).toContain('value="00001"');
    expect(html.match(/role="alert"/g)).toHaveLength(1); expect(html).toContain("(obligatorio)");
  });
  it("does not duplicate, replace or initialize controls while grouping them", () => {
    const html = renderToStaticMarkup(<FormLayout><FormGrid slots={[
      { key: "first", content: <input aria-label="Primero" value="001" readOnly /> },
      { key: "long", fullWidth: true, content: <textarea aria-label="Detalle" defaultValue="Texto existente" /> },
    ]} /></FormLayout>);
    expect(html.match(/<input /g)).toHaveLength(1); expect(html.match(/<textarea /g)).toHaveLength(1); expect(html).toContain('value="001"'); expect(html).toContain("Texto existente");
  });
  it("exposes disabled and busy independently without invoking a supplied action", () => {
    const action = vi.fn();
    const html = renderToStaticMarkup(<FormActions><FormAction label="Guardar" busyLabel="Guardando" busy disabled onPress={action} /><FormAction label="Volver" variant="secondary" onPress={action} /></FormActions>);
    expect(html).toContain('aria-label="Guardando"'); expect(html).toContain('aria-busy="true"'); expect(html).toContain('aria-disabled="true"'); expect(html).toContain('aria-label="Volver"'); expect(action).not.toHaveBeenCalled();
  });
});
