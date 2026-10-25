import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { activateCompactCheckboxFromKeyboard, changeCompactSelection, CompactSelect } from "./compact-select";
vi.mock("react-native", async () => import("react-native-web"));

describe("shared compact selection", () => {
  const options = [{ value: "option-id", label: "Turno A" }, { value: "inactive", label: "Anterior", disabled: true }];
  it("retains IDs, no default selection, required placeholder and disabled options", () => {
    const html = renderToStaticMarkup(<CompactSelect label="Turno" required options={options} value="" onChange={() => { throw Error("render must not select"); }} />);
    expect(html).toContain('aria-label="Turno"');
    expect(html).toContain('<option value="" disabled="" selected="">');
    expect(html).toContain('value="option-id"');
    expect(html).toContain('value="inactive" disabled=""');
  });
  it("retains unavailable selection instead of defaulting and exposes disabled control", () => {
    const html = renderToStaticMarkup(<CompactSelect label="Estado" options={options} value="old" disabled onChange={vi.fn()} />);
    expect(html).toContain('value="old" disabled="" selected=""');
    expect(html).toContain('disabled=""');
    expect(html).toContain("Selección no disponible");
  });
  it("allows clearing only optional selections", () => {
    expect(renderToStaticMarkup(<CompactSelect label="Grupo" options={options} value="" onChange={vi.fn()} />)).toContain('value="" selected="">Sin selección');
    expect(changeCompactSelection(["a"], "a", true, true)).toEqual(["a"]);
    expect(changeCompactSelection(["a"], "a", true, false)).toEqual([]);
    expect(changeCompactSelection(["a", "b"], "a", true, true)).toEqual(["b"]);
  });
  it("exposes the collapsed multiple choice and its selection to assistive technology", () => {
    const html = renderToStaticMarkup(<CompactSelect label="Etiquetas" multiple value={["option-id"]} options={options} onChange={vi.fn()} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Etiquetas: Turno A"');
  });
  it("keeps multiple values independent and single choice scalar", () => {
    expect(changeCompactSelection(["a"], "b", true, true)).toEqual(["a", "b"]);
    expect(changeCompactSelection(["a"], "b", false, true)).toBe("b");
  });
});

it("Space activates a multiple choice once, preserving required/disabled semantics; Enter stays delegated", () => {
  let values=["A"]; const event={key:" ",repeat:false,preventDefault(){},stopPropagation(){}};
  const activate=()=>{ values=changeCompactSelection(values,"B",true,true) as string[]; };
  expect(activateCompactCheckboxFromKeyboard(event,false,activate)).toBe(true);expect(values).toEqual(["A","B"]);
  expect(activateCompactCheckboxFromKeyboard({...event,repeat:true},false,activate)).toBe(false);expect(values).toEqual(["A","B"]);
  expect(activateCompactCheckboxFromKeyboard(event,true,activate)).toBe(false);expect(values).toEqual(["A","B"]);
  expect(activateCompactCheckboxFromKeyboard({...event,key:"Enter"},false,activate)).toBe(false);expect(values).toEqual(["A","B"]);
});
