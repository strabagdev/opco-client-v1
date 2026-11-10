import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EntityField } from "../../lib/opco-api";
import { RecordFieldInput } from "./RecordFieldInput";

vi.mock("react-native", async () => import("react-native-web"));
vi.mock("./temporal-input", async () => import("./temporal-input.web"));

const field = { id: "field-1", key: "enabled", name: "Habilitado", type: "BOOLEAN", required: false } as EntityField;

describe("field accessibility without changing values", () => {
  it("exposes the boolean as a named checked control, without writing on render", () => {
    const change = vi.fn();
    const html = renderToStaticMarkup(<RecordFieldInput field={field} value={true} onChange={change} />);
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="Habilitado"');
    expect(change).not.toHaveBeenCalled();
  });

  it.each(["TEXT", "SELECT", "DATE", "RELATION", "DATETIME", "MULTISELECT"] as const)("associates %s with its visible label and validation message", type => {
    const html = renderToStaticMarkup(<RecordFieldInput field={{ ...field, type, required: true, options: [] }}
      value="" error="Revisa este campo" onChange={vi.fn()} relationTargetEntityTypeId="catalog" />);
    expect(html).toContain('aria-invalid="true"');
    const description = html.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(description).toBeTruthy();
    for (const id of description!.split(" ")) expect(html).toContain(`id="${id}"`);
    const label = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(label).toBeTruthy();
    for (const id of label!.split(" ")) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('role="alert"');
  });
});
