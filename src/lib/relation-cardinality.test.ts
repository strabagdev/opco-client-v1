import {describe,it,expect} from "vitest";
import {relationKind,relationKindIsAmbiguous,relationCardinalityIssue} from "./relation-cardinality";
describe("canonical RELATION metadata",()=>{
 it.each(["ONE","MANY"] as const)("reads flat/nested %s without using the generic mirror",kind=>{
  expect(relationKind({relationKind:kind})).toBe(kind);expect(relationKind({relation:{relationKind:kind}})).toBe(kind);
  expect(relationCardinalityIssue({type:"RELATION",multiple:kind!=="MANY",config:{relationKind:kind}})).toBeTruthy();
  expect(relationCardinalityIssue({type:"RELATION",multiple:kind==="MANY",config:{relation:{relationKind:kind}}})).toBeNull();
 });
 it("distinguishes ambiguous kinds, an old omitted kind, and non-relation fields",()=>{
  expect(relationKindIsAmbiguous({relationKind:"ONE",relation:{relationKind:"MANY"}})).toBe(true);
  expect(relationKindIsAmbiguous({relationKind:"invalid"})).toBe(true);expect(relationKind({})).toBe("ONE");
  expect(relationCardinalityIssue({type:"SELECT",multiple:true})).toBeNull();
 });
});
