import {prepareStateUpdateContextOnce,type StateUpdateContextPreparationInput} from "./app-view-prewarm";
import {describe,it,expect,vi,beforeEach} from "vitest";
const factory=vi.hoisted(()=>({create:vi.fn()}));
vi.mock("./preparation-revision-receipts",()=>({createPreparationRevisionRun:factory.create}));
vi.mock("expo-sqlite",()=>({openDatabaseAsync:vi.fn()}));

function fixture(){
 const view={id:"context-view",type:"WORKFLOW",name:"Synthetic",config:{workflowKey:"state-update"}},scope={ownerKey:"org:user",contractId:"contract",appViewId:view.id,sourceEntityTypeId:"source",targetEntityTypeId:"target",date:"2026-11-15",dateFieldId:"date",uniqueness:"subject-date-fields",historyMode:"update-current",identity:{version:1,definitionId:"definition",values:{shift:"stable-option-id",relation:"stable-record-id"}}};
 const empty={records:[],pagination:{page:1,pageSize:100,total:0,totalPages:1}};
 const api={genericReuseEnabled:true,getEntityRecords:vi.fn(async()=>empty),getStateUpdateWorkflow:vi.fn(),getEntityDefinition:vi.fn(),getOfflineRevisionManifest:vi.fn(),getRevisionRead:vi.fn()};
 const store={getAppViewDefinition:vi.fn(async()=>({status:"ready",definition:{kind:"state-update",appView:view}})),getAppViews:vi.fn(async()=>({views:[view]})),upsertAppViewDefinition:vi.fn(),getStateUpdateCurrentCoverage:vi.fn(async()=>null),setStateUpdateCurrentCoverage:vi.fn(),listCachedRecords:vi.fn(async()=>empty),reconcileRemoteRecordsSnapshot:vi.fn(),upsertStateUpdateSnapshot:vi.fn()};
 return{api,store,scope,input:{api,store,scope,force:true,token:"synthetic",signal:new AbortController().signal} as unknown as StateUpdateContextPreparationInput};
}
beforeEach(()=>factory.create.mockReset());
describe("selected context keeps the existing coordinator and fallback",()=>{
 it("consumes a verified context without starting another source/current download",async()=>{
  const x=fixture(),finish=vi.fn(async()=>[]);factory.create.mockResolvedValue({recording:true,tryReusePreparation:async()=>true,finish});
  await prepareStateUpdateContextOnce(x.input);
  expect(x.api.getEntityRecords).not.toHaveBeenCalled();expect(x.api.getStateUpdateWorkflow).not.toHaveBeenCalled();expect(finish).toHaveBeenCalledOnce();
  expect(factory.create).toHaveBeenCalledWith(expect.objectContaining({contextScope:x.scope}));
 });
 it("a withdrawn context performs one normal download and cannot recurse into another reuse",async()=>{
  const x=fixture();factory.create.mockResolvedValue({recording:true,tryReusePreparation:async()=>true,finish:async()=>[x.scope.appViewId]});
  await prepareStateUpdateContextOnce(x.input);
  expect(factory.create).toHaveBeenCalledOnce();expect(x.api.getEntityRecords).toHaveBeenCalledOnce();expect(x.api.getEntityDefinition).not.toHaveBeenCalled();
  expect(x.store.setStateUpdateCurrentCoverage).toHaveBeenLastCalledWith(expect.objectContaining({coverage:expect.objectContaining({status:"complete",sourceComplete:true,totalSubjects:0})}));
 });
 it("unavailable receipt capture preserves the legacy preparation instead of adding anchor downloads",async()=>{
  const x=fixture();factory.create.mockResolvedValue({recording:false});await prepareStateUpdateContextOnce(x.input);
  expect(x.api.getEntityRecords).toHaveBeenCalledOnce();expect(x.api.getEntityDefinition).not.toHaveBeenCalled();
 });
});
