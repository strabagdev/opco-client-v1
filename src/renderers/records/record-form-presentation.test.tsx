import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EntityField } from "../../lib/opco-api";
import { RecordFieldInput } from "./RecordFieldInput";
vi.mock("react-native", async () => import("react-native-web"));
vi.mock("./temporal-input", async () => import("./temporal-input.web"));

const field = (type: EntityField["type"], extra: Partial<EntityField> = {}) => ({ id: "stable-field", key: "stable_key", name: "Campo configurado", type, required: false, active: true, searchable: false, multiple: false, options: [{ id: "option-id", value: "canonical-value", label: "Etiqueta legible", order: 0, active: true }, { id: "inactive", value: "old", label: "Inactiva", order: 1, active: false }], config: {}, ...extra }) as EntityField;

describe.each([undefined, "form"] as const)("controlled record field presentation %s", presentation => {
  it.each([
    ["TEXT", "000123-K", 'value="000123-K"'],
    ["TEXTAREA", "Texto sin transformar", "Texto sin transformar"],
    ["DECIMAL", "10.1", 'value="10.1"'],
    ["DATE", "2026-11-08", 'value="2026-11-08"'],
    ["TIME", "08:30", 'value="08:30"'],
    ["DATETIME", "2026-11-08T08:30", 'value="08:30"'],
    ["SELECT", "canonical-value", 'value="canonical-value" selected=""'],
    ["MULTISELECT", ["canonical-value", "old"], "Etiqueta legible, Inactiva"],
  ] as const)("keeps %s values, labels and accessibility without writing on render", (type, value, expected) => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(<RecordFieldInput presentation={presentation} field={field(type)} value={typeof value === "string" ? value : [...value]} onChange={onChange} error="Revisa el valor" />);
    expect(html).toContain(expected); expect(onChange).not.toHaveBeenCalled();
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    const label = html.match(/aria-labelledby="([^"]+)"/)?.[1]; expect(label).toBeTruthy();
    for (const id of label!.split(" ")) expect(html).toContain(`id="${id}"`);
    const description = html.match(/aria-describedby="([^"]+)"/)?.[1]; expect(description).toBeTruthy();
    for (const id of description!.split(" ")) expect(html).toContain(`id="${id}"`);
  });
  it("keeps optional/required selection and unavailable values", () => {
    const html = renderToStaticMarkup(<RecordFieldInput presentation={presentation} field={field("SELECT", { required: true })} value="not-available" onChange={vi.fn()} />);
    expect(html).toContain('value="" disabled=""'); expect(html).toContain('value="not-available" disabled="" selected=""');
    expect(html).toContain("Selección no disponible");
  });
  it.each([false, true, undefined])("does not default or invert a controlled boolean %s", value => {
    const onChange = vi.fn(); const html = renderToStaticMarkup(<RecordFieldInput presentation={presentation} field={field("BOOLEAN")} value={value} onChange={onChange} />);
    expect(html).toContain(`aria-checked="${value === true}"`); expect(onChange).not.toHaveBeenCalled();
  });
  it("keeps every value of a MANY relation without choosing or clearing on render", () => {
    const change = vi.fn();
    const html = renderToStaticMarkup(<RecordFieldInput presentation={presentation} field={field("RELATION", { multiple: true, config: { relation: { relationKind: "MANY", targetEntityTypeId: "catalog" } } })} value={["one", "two"]}
      relationTargetEntityTypeId="catalog" relationOptions={[{ id: "one", displayName: "Primera relación" }, { id: "two", displayName: "Segunda relación" }]} onChange={change} />);
    expect(html).toContain("Primera relación, Segunda relación"); expect(change).not.toHaveBeenCalled();
  });
  it("keeps relation IDs, labels, current selection and catalogue paging action", () => {
    const change = vi.fn(), search = vi.fn(), more = vi.fn();
    const html = renderToStaticMarkup(<RecordFieldInput presentation={presentation} field={field("RELATION", { config: { relation: { relationKind: "ONE", targetEntityTypeId: "catalog" } } })} value="record-id"
      relationTargetEntityTypeId="catalog" relationOptions={[{ id: "record-id", displayName: "Registro relacionado" }]} onChange={change} onRelationSearch={search} onRelationLoadMore={more} />);
    expect(html).toContain('value="record-id" selected=""'); expect(html).toContain("Registro relacionado"); expect(html).toContain("Más opciones");
    expect(change).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled(); expect(more).not.toHaveBeenCalled();
  });
  it.each(["ONE", "MANY"] as const)("distinguishes relation search from the current %s selection only in the form variant", relationKind => {
    const change = vi.fn();
    const html = renderToStaticMarkup(<RecordFieldInput presentation={presentation}
      field={field("RELATION", { multiple: relationKind === "MANY", config: { relation: { relationKind, targetEntityTypeId: "catalog" } } })}
      value={relationKind === "MANY" ? ["one", "two"] : "one"} relationTargetEntityTypeId="catalog"
      relationOptions={[{ id: "one", displayName: "Primera relación" }, { id: "two", displayName: "Segunda relación" }]}
      onChange={change} error="Revisa la selección" />);
    expect(change).not.toHaveBeenCalled();
    if (presentation === "form") {
      expect(html).toContain("Buscar opciones"); expect(html).toContain("Selección actual");
      const searchLabel = html.match(/id="([^"]+)"[^>]*>Buscar opciones</)?.[1];
      const selectedLabel = html.match(/id="([^"]+)"[^>]*>Selección actual</)?.[1];
      expect(searchLabel).toBeTruthy(); expect(selectedLabel).toBeTruthy();
      expect(html).toMatch(new RegExp(`aria-labelledby="[^"]* ${searchLabel}"`));
      expect(html).toMatch(new RegExp(`aria-labelledby="[^"]* ${selectedLabel}"`));
      expect(html).toContain('aria-label="Buscar Campo configurado"');
    } else {
      expect(html).not.toContain("Buscar opciones"); expect(html).not.toContain("Selección actual");
    }
  });
});
