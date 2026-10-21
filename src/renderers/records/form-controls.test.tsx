import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DateFieldInput, DateTimeFieldInput, MonthFieldInput, TimeFieldInput } from "./temporal-input.web";
import { temporalSelectionAllowed } from "./temporal-input.types";
import { RecordFieldInput } from "./RecordFieldInput";
import { composeDateTimeValue } from "../../lib/record-form";
import type { EntityField } from "../../lib/opco-api";
vi.mock("react-native", async () => import("react-native-web"));
vi.mock("./temporal-input", async () => import("./temporal-input.web"));
const field = { id: "field", key: "field", name: "Campo sintético", type: "SELECT", required: true, options: [{id:"stable-id",label:"Turno",value:"A",order:0,active:true}], multiple:false } as EntityField;

describe("actual shared field controls", () => {
  it("renders logical DATE with picker, accessible name and Attendance's caller-owned limit", () => {
    const html = renderToStaticMarkup(<DateFieldInput label="Fecha de asistencia" required value="2026-10-21" max="2026-10-21" onChange={vi.fn()} />);
    expect(html).toContain('type="date"'); expect(html).toContain('value="2026-10-21"');
    expect(html).toContain('max="2026-10-21"'); expect(html).toContain('aria-label="Fecha de asistencia"');
    expect(temporalSelectionAllowed("2026-10-22",{required:true,max:"2026-10-21"})).toBe(false);
    expect(temporalSelectionAllowed("2026-10-20",{required:true,max:"2026-10-21"})).toBe(true);
    expect(temporalSelectionAllowed("",{required:true})).toBe(false);
    expect(temporalSelectionAllowed("",{required:false})).toBe(true);
    expect(temporalSelectionAllowed("2030-01-01",{required:true})).toBe(true);
  });
  it("shows historical ISO DATE as its logical date without a timezone conversion or write", () => {
    const change=vi.fn();
    const html=renderToStaticMarkup(<DateFieldInput required label="Fecha" value="2026-08-13T00:00:00.000Z" onChange={change} />);
    expect(html).toContain('value="2026-08-13"'); expect(change).not.toHaveBeenCalled();
  });
  it("keeps month filters monthly and TIME precision unchanged", () => {
    const html = renderToStaticMarkup(<MonthFieldInput label="Mes" required value="2026-10" onChange={vi.fn()} />);
    expect(html).toContain('type="month"');expect(html).toContain('value="2026-10"');
    expect(renderToStaticMarkup(<TimeFieldInput required value="08:00" onChange={vi.fn()} />)).toContain('step="60"');
  });
  it("keeps DATETIME local parts and existing instant composition", () => {
    const value=composeDateTimeValue("2026-10-21","08:00");
    const html=renderToStaticMarkup(<DateTimeFieldInput label="Instante" required value={value} onChange={vi.fn()} />);
    expect(html).toContain('value="2026-10-21"');expect(html).toContain('value="08:00"');
    expect(html).toContain('aria-label="Instante: fecha"');
  });
  it("RecordFieldInput sends canonical option values, never option IDs as values", () => {
    const html=renderToStaticMarkup(<RecordFieldInput field={field} value="A" onChange={vi.fn()} />);
    expect(html).toContain('value="A" selected=""');expect(html).not.toContain('value="stable-id"');
  });
  it("relation keeps loaded search results, readable labels and record IDs without fetching", () => {
    const search=vi.fn(),change=vi.fn();
    const html=renderToStaticMarkup(<RecordFieldInput field={{...field,type:"RELATION"}} value="remote-record" onChange={change} onRelationSearch={search}
      relationTargetEntityTypeId="catalog" relationOptions={[{id:"remote-record",displayName:"Equipo sintético"}]} />);
    expect(html).toContain('value="remote-record" selected=""');expect(html).toContain("Equipo sintético");
    expect(html).toContain("Buscar en catalogo");expect(search).not.toHaveBeenCalled();expect(change).not.toHaveBeenCalled();
  });
  it("optional DATE exposes clear, required DATE never exposes a clear action", () => {
    const date={label:"Fecha",value:"2026-10-21",onChange:vi.fn()};
    expect(renderToStaticMarkup(<DateFieldInput {...date} required={false} />)).toContain("Limpiar Fecha");
    expect(renderToStaticMarkup(<DateFieldInput {...date} required />)).not.toContain("Limpiar Fecha");
  });
});
