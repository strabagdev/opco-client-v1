import {describe,it,expect} from "vitest";
import {matchesPreparationRequest,type PreparationCoverage,type PreparationReceiptRequest,type PreparationRevisionReceipt} from "./preparation-revision-contract";
import type {PreparedAppViewDefinition} from "./app-view-definitions-cache";
const coverage:PreparationCoverage={version:1,kind:"attendance-month",complete:true,scope:"ordinary-preparation",businessDataIncluded:true,arbitraryQueries:false,relationCatalogs:false,latest:"complete-snapshot",dates:Array.from({length:30},(_,i)=>"2026-11-"+String(i+1).padStart(2,"0")),sourceEntityTypeId:"source",subjectCount:1};
const receipt:Pick<PreparationRevisionReceipt,"appViewId"|"coverage"|"markers"|"snapshotId">={appViewId:"view",coverage,markers:[],snapshotId:"copy1"};
const prepared={kind:"unsupported",appView:{id:"view",type:"WORKFLOW",config:{contextFieldIds:["select","relation"]}}} as unknown as PreparedAppViewDefinition;
const request:PreparationReceiptRequest={appViewId:"view",kind:"attendance-month",dates:coverage.dates};
describe("explicit requested coverage (never a read-omission permission)",()=>{
 it("accepts only the same exact month/snapshot/definition",()=>{expect(matchesPreparationRequest(receipt,{...request,snapshotId:"copy1",definition:prepared.appView},prepared)).toBe(true);});
 it.each([{appViewId:"another"},{kind:"metadata-only"},{dates:["2026-12-01"]},{dates:[]},{snapshotId:"copy2"}])("denies another coverage %j",change=>{expect(matchesPreparationRequest(receipt,{...request,...change}as PreparationReceiptRequest,prepared)).toBe(false);});
 it("requires configured SELECT/RELATION definitions to remain exact",()=>{expect(matchesPreparationRequest(receipt,{...request,definition:{...prepared.appView,config:{contextFieldIds:["relation","select"]}}as typeof prepared.appView},prepared)).toBe(false);});
 it("does not infer a selected context from a context-free preparation",()=>{expect(matchesPreparationRequest(receipt,{...request,identity:{version:1,definitionId:"id",values:{field:"choice"}}},prepared)).toBe(false);});
 it("requires exact identity values when markers carry a selected context",()=>{const identity={version:1 as const,definitionId:"id",values:{field:"choice"}};const scoped={...receipt,markers:[{kind:"attendance"as const,scope:{ownerKey:"org:user",contractId:"contract",appViewId:"view",targetEntityTypeId:"target",date:"2026-11-01",identity}}]};expect(matchesPreparationRequest(scoped,{...request,identity},prepared)).toBe(true);expect(matchesPreparationRequest(scoped,request,prepared)).toBe(false);expect(matchesPreparationRequest(scoped,{...request,identity:{...identity,values:{field:"different"}}},prepared)).toBe(false);});
});
