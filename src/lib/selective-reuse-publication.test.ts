import {describe,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({run:vi.fn()}));
vi.mock("./preparation-revision-receipts",()=>({createPreparationRevisionRun:mocks.run}));
vi.mock("expo-sqlite",()=>({openDatabaseAsync:vi.fn()}));
import {prewarmAssignedAppViews} from "./app-view-prewarm";

it("does not publish a reused view before final validation",async()=>{
  let enter!:()=>void,release!:()=>void;
  const entered=new Promise<void>(resolve=>enter=resolve),hold=new Promise<void>(resolve=>release=resolve);
  const done=vi.fn(),store={reconcileAppViewDefinitions:vi.fn()};
  mocks.run.mockResolvedValue({api:{},store,tryReuseAttendance:async()=>true,prepareCatalogs:async()=>{},viewResult(){},validatedReuseIds:()=>["view"],finish:async()=>{enter();await hold;return[];}});
  const task=prewarmAssignedAppViews({api:{},store,appViews:[{id:"view",name:"Synthetic",type:"WORKFLOW",config:{workflowKey:"attendance"}}],ownerKey:"org:user",contractId:"contract",token:"synthetic",onAppViewPrepared:done,
    homeListWrite:Promise.resolve({status:"persisted",scope:{ownerKey:"org:user",contractId:"contract",appViewIds:["view"]},count:1,syncedAt:"2026-11-13T00:00:00Z",requestId:null,errorCode:null})} as unknown as Parameters<typeof prewarmAssignedAppViews>[0]);
  await entered;
  try{expect(done).not.toHaveBeenCalled();}finally{release();await task;}
  expect(done).toHaveBeenCalledExactlyOnceWith("view");
});

describe("a retired reuse decision",()=>{
 it("does not mark a failed ordinary fallback as prepared",async()=>{
  const view={id:"view",name:"Synthetic",type:"WORKFLOW",config:{workflowKey:"attendance"}},done=vi.fn();
  const store={reconcileAppViewDefinitions:vi.fn(),upsertAppViews:vi.fn(),getAppViews:async()=>({views:[view],syncedAt:"2026-11-13T00:00:00Z"})};
  let calls=0;
  mocks.run.mockImplementation(async()=>{const first=++calls===1;return{api:{getAttendanceWorkflow:async()=>{throw Error("Synthetic denied download");}},store,tryReuseAttendance:async()=>first,prepareCatalogs:async()=>{},viewResult(){},validatedReuseIds:()=>[],finish:async()=>first?["view"]:[]};});
  await prewarmAssignedAppViews({api:{},store,appViews:[view],ownerKey:"org:user",contractId:"contract",token:"synthetic",onAppViewPrepared:done,
    homeListWrite:Promise.resolve({status:"persisted",scope:{ownerKey:"org:user",contractId:"contract",appViewIds:["view"]},count:1,syncedAt:"2026-11-13T00:00:00Z",requestId:null,errorCode:null})} as unknown as Parameters<typeof prewarmAssignedAppViews>[0]);
  expect(calls).toBe(2);expect(done).not.toHaveBeenCalled();
 });
});
