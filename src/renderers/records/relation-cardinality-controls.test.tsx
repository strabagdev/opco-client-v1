import {renderToStaticMarkup} from "react-dom/server";
import {describe,it,expect,vi} from "vitest";
import {RecordFieldInput} from "./RecordFieldInput";
import type {EntityField} from "../../lib/opco-api";
vi.mock("react-native",async()=>import("react-native-web"));
vi.mock("./temporal-input",async()=>import("./temporal-input.web"));
const field=(kind:"ONE"|"MANY",multiple:boolean):EntityField=>({id:"relation",key:"relation",name:"Synthetic relation",type:"RELATION",required:false,multiple,config:{relation:{relationKind:kind,targetEntityTypeId:"catalog"}}});
const options=[{id:"a",displayName:"Synthetic A"},{id:"b",displayName:"Synthetic B"}];
describe("real relation controls use canonical cardinality",()=>{
 it("uses a single select for historical ONE/true, keeps its label, and performs no automatic change",()=>{
  const onChange=vi.fn();const html=renderToStaticMarkup(<RecordFieldInput field={field("ONE",true)} value="a" onChange={onChange} relationTargetEntityTypeId="catalog" relationOptions={options}/>);
  expect(html).toContain("<select");expect(html).toContain("Synthetic A");expect(html).toContain("cardinalidad");expect(onChange).not.toHaveBeenCalled();
 });
 it("uses a multiple control for MANY/false and shows every retained selection",()=>{
  const html=renderToStaticMarkup(<RecordFieldInput field={field("MANY",false)} value={["a","b"]} onChange={vi.fn()} relationTargetEntityTypeId="catalog" relationOptions={options}/>);
  expect(html).not.toContain("<select");expect(html).toContain("Synthetic A, Synthetic B");
 });
 it("blocks an overfull ONE control without hiding or replacing either retained label",()=>{
  const onChange=vi.fn();const html=renderToStaticMarkup(<RecordFieldInput field={field("ONE",false)} value={["a","b"]} onChange={onChange} relationTargetEntityTypeId="catalog" relationOptions={options}/>);
  expect(html).toContain("Synthetic A, Synthetic B");expect(html).toContain('disabled=""');expect(html).toContain("requiere revisión");expect(onChange).not.toHaveBeenCalled();
 });
});
