import {describe,it,expect} from "vitest";
import {catalogDependencies} from "./catalog-revision-contract";
import type {AppView,EntityDefinition,EntityField} from "./opco-api";
import type {PreparedAppViewDefinition} from "./app-view-definitions-cache";
const field=(id:string,type:EntityField["type"],config?:Record<string,unknown>):EntityField=>({id,key:id,name:id,type,active:true,required:false,config});
const entity=(id:string,fields:EntityField[]):EntityDefinition=>({id,name:id,slug:id,active:true,icon:null,fields});
const option=()=>({...field("choice","SELECT"),options:[{id:"o",label:"Label",value:"VALUE",active:true,order:0},{id:"off",label:"Off",value:"OFF",active:false,order:1}]});
describe("catalog dependency inventory",()=>{
 it("inventories SELECT, ONE and MANY once without traversing all related forms",()=>{
  const d=entity("source",[option(),field("one","RELATION",{relationKind:"ONE",targetEntityTypeId:"catalog"}),field("many","RELATION",{relation:{relationKind:"MANY",targetEntityTypeId:"catalog"}}),{...field("hidden","RELATION",{targetEntityTypeId:"hidden"}),active:false}]);
  const view={id:"view",type:"RECORDS",config:{entityTypeId:"source"}} as AppView;
  const result=catalogDependencies(view,{kind:"records",appView:view,entityDefinition:d},new Map([[d.id,d]]));
  expect(result.map(d=>d.fieldId)).toEqual(["choice","many","one"]);expect(result.filter(d=>d.targetEntityTypeId).map(d=>d.cardinality)).toEqual(["MANY","ONE"]);
 });
 it("rejects unavailable relations rather than inventing a target or enabling fields",()=>{
  const d=entity("source",[field("one","RELATION")]),view={id:"view",type:"RECORDS",config:{entityTypeId:"source"}} as AppView;
  expect(()=>catalogDependencies(view,{kind:"records",appView:view,entityDefinition:d},new Map([[d.id,d]]))).toThrow("CATALOG_TARGET_UNAVAILABLE");
 });
 function workflow(){
  const choice=option(),subject=field("subject","RELATION",{relationKind:"ONE",targetEntityTypeId:"source"}),many=field("references","RELATION",{relationKind:"MANY",targetEntityTypeId:"catalog"});
  const source=entity("source",[]),target=entity("target",[choice,subject,many]);
  const view={id:"view",type:"WORKFLOW",config:{workflowKey:"state-update",sourceEntityTypeId:"source",targetEntityTypeId:"target",subjectFieldId:"subject",stateFields:[{fieldId:"choice"}],extraFieldIds:["references"],uniqueness:{mode:"subject-date-fields"}}} as AppView;
  const prepared={kind:"state-update",appView:view,sourceEntityTypeId:"source",targetEntityTypeId:"target",subjectFieldId:"subject",stateFields:[{fieldId:"choice",label:"choice",type:"SELECT",required:false,options:[{optionId:"o",label:"Label"}]}],extraFields:[many],identityFields:[{fieldId:"choice",label:"choice",type:"SELECT",required:true,options:[{optionId:"o",label:"Label",value:"VALUE"}]}],historyMode:"update-current",uniqueness:"subject-date-fields"} as PreparedAppViewDefinition;
  return{view,prepared,defs:new Map([[source.id,source],[target.id,target]])};
 }
 it("includes subject lookup, state, extras and identity choices independently of selected values",()=>{
  const x=workflow(),r=catalogDependencies(x.view,x.prepared,x.defs);expect(r.find(d=>d.fieldId==="choice")?.roles).toEqual(["identity","state"]);expect(r.find(d=>d.fieldId==="references")).toMatchObject({targetEntityTypeId:"catalog",cardinality:"MANY"});expect(r.find(d=>d.fieldId==="subject")).toMatchObject({targetEntityTypeId:"source",roles:["subject"]});
 });
 it("accepts the existing implicit SELECT state adapter without changing stored definitions",()=>{
  const x=workflow();if(x.prepared.kind!=="state-update")throw Error("fixture");delete x.prepared.stateFields[0].type;expect(catalogDependencies(x.view,x.prepared,x.defs).find(d=>d.fieldId==="choice")?.type).toBe("SELECT");
 });
 it.each(["label","value","removed","type","relation"])("refuses stale prepared choices after %s changes",kind=>{
  const x=workflow(),root=x.defs.get("target")!;
  if(kind==="label")root.fields[0].options![0].label="Changed";if(kind==="value")root.fields[0].options![0].value="Changed";if(kind==="removed")root.fields[0].options![0].active=false;
  if(kind==="type")root.fields[0].type="TEXT";
  if(kind==="relation")root.fields[2]={...root.fields[2],config:{relationKind:"ONE",targetEntityTypeId:"catalog"}};
  expect(()=>catalogDependencies(x.view,x.prepared,x.defs)).toThrow();
 });
});
