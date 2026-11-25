// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createHomeOfflineAvailabilityRefresh } from "./home-offline-availability-refresh";

// Execute the real Home callback; the fixture replaces only storage and the UI setter.
const source=ts.createSourceFile("home.tsx",readFileSync("app/(app)/index.tsx","utf8"),ts.ScriptTarget.Latest,true);
let expression="";
function visit(node:ts.Node){
 if(ts.isVariableDeclaration(node)&&node.name.getText(source)==="refreshOfflineAvailability"&&node.initializer&&ts.isCallExpression(node.initializer))expression=node.initializer.arguments[0].getText(source);
 ts.forEachChild(node,visit);
}
visit(source);
if(!expression)throw new Error("Home availability callback missing");
const js=ts.transpile("const read="+expression,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None});
const views=[
 {id:"records-a",type:"RECORDS",config:{entityTypeId:"people"}},
 {id:"records-b",type:"RECORDS",config:{entityTypeId:"people"}},
 {id:"attendance-a",type:"WORKFLOW",config:{workflowKey:"attendance"}},
 {id:"attendance-b",type:"WORKFLOW",config:{workflowKey:"attendance"}},
 {id:"state",type:"WORKFLOW",config:{workflowKey:"state-update"}},
];
function fixture(){
 const store={
  getAppViewDefinition:vi.fn(async (_o:string,_c:string,id:string)=>({definition:{kind:id.includes("records")?"records":id.startsWith("attendance")?"attendance":"state-update",sourceEntityTypeId:"people",targetEntityTypeId:"events",appView:{id}}})),
  getRecordCacheStatusCounts:vi.fn(async()=>({total:0})),
  getSyncTelemetry:vi.fn(async (_scope:unknown)=>({revision:1})),
  getAttendanceDaySnapshotHydration:vi.fn(async (_scope:unknown)=>({lastSuccessfulRefreshAt:"2026-11-22T12:00:00Z"})),
  getStateUpdateSnapshotCoverage:vi.fn(async (_scope:unknown)=>null),
 };
 const publish=vi.fn();
 const make=(owner="owner",contract="contract")=>new Function("definitionCache","selectedContractId","ownerKey","today","observedAt","attendancePreparationPeriod","deriveAttendanceMonthStatus","buildStateUpdateCoverageScope","deriveOfflineAvailability","setOfflineAvailabilityByViewId",js+";return read;")(
  store,contract,owner,"2026-11-22",new Date("2026-11-22T12:00:00Z"),()=>({date:"2026-11-22",dates:["2026-11-21","2026-11-22"]}),(days:unknown)=>days,(scope:unknown)=>scope,(input:unknown)=>input,publish,
 ) as (input:typeof views,canUpdate?:()=>boolean)=>Promise<void>;
 return{store,publish,make};
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}

describe("Home shares equivalent local reads only within a current pass",()=>{
 it("shares source telemetry and today's hydration without merging different AppViews",async()=>{
  const f=fixture();await f.make()(views);
  expect(f.store.getSyncTelemetry).toHaveBeenCalledTimes(1);
  expect(f.store.getRecordCacheStatusCounts).toHaveBeenCalledTimes(1);
  expect(f.store.getAttendanceDaySnapshotHydration).toHaveBeenCalledTimes(4);
  expect(new Set(f.store.getAttendanceDaySnapshotHydration.mock.calls.map(([s])=>JSON.stringify(s))).size).toBe(4);
  expect(f.publish).toHaveBeenCalledOnce();
  expect(f.store.getStateUpdateSnapshotCoverage).toHaveBeenCalledOnce();
 });
 it("does not share across passes, owners or contracts",async()=>{
  const f=fixture(),read=f.make();await read(views);await read(views);await f.make("other-owner")(views);await f.make("owner","other-contract")(views);
  expect(f.store.getSyncTelemetry.mock.calls.map(([scope])=>scope)).toEqual([
   {ownerKey:"owner",contractId:"contract",entityTypeId:"people"},{ownerKey:"owner",contractId:"contract",entityTypeId:"people"},
   {ownerKey:"other-owner",contractId:"contract",entityTypeId:"people"},{ownerKey:"owner",contractId:"other-contract",entityTypeId:"people"},
  ]);
 });
 it("keeps distinct source entities separate within the pass",async()=>{
  const f=fixture();await f.make()([...views,{id:"other-records",type:"RECORDS",config:{entityTypeId:"other-people"}}]);
  expect(f.store.getSyncTelemetry).toHaveBeenCalledTimes(2);
 });
 it("discards held telemetry after invalidation and reads fresh in the existing trailing pass",async()=>{
  const f=fixture(),held=deferred<{revision:number}>(),entered=deferred<void>();
  f.store.getSyncTelemetry.mockImplementationOnce(async()=>{entered.resolve();return held.promise;}).mockResolvedValue({revision:2});
  const read=f.make(),coordinator=createHomeOfflineAvailabilityRefresh(canUpdate=>read(views,canUpdate));
  const active=coordinator.request();await entered.promise;void coordinator.request();held.resolve({revision:1});await active;
  expect(f.store.getSyncTelemetry).toHaveBeenCalledTimes(2);
  expect(f.publish).toHaveBeenCalledOnce();
  const value=f.publish.mock.calls[0][0];expect(value["records-a"].recordsTelemetry).toEqual({revision:2});expect(value["attendance-a"].sourceTelemetry).toEqual({revision:2});coordinator.dispose();
 });
 it("discards held hydration after a cache change and never publishes the invalidated month",async()=>{
  const f=fixture(),held=deferred<{lastSuccessfulRefreshAt:string}>(),entered=deferred<void>();
  f.store.getAttendanceDaySnapshotHydration.mockImplementationOnce(async()=>{entered.resolve();return held.promise;}).mockResolvedValue({lastSuccessfulRefreshAt:"fresh"});
  const read=f.make(),coordinator=createHomeOfflineAvailabilityRefresh(canUpdate=>read(views,canUpdate));
  const active=coordinator.request();await entered.promise;void coordinator.request();held.resolve({lastSuccessfulRefreshAt:"old"});await active;
  expect(f.publish).toHaveBeenCalledOnce();expect(f.publish.mock.calls[0][0]["attendance-a"].attendanceDayHydration).toEqual({lastSuccessfulRefreshAt:"fresh"});coordinator.dispose();
 });
 it("does not retain rejected reads for a subsequent pass",async()=>{
  const f=fixture(),read=f.make();f.store.getSyncTelemetry.mockRejectedValueOnce(new Error("synthetic read failure"));
  await read(views);expect(f.publish).toHaveBeenLastCalledWith(Object.fromEntries(views.map(v=>[v.id,"dependencies-unavailable"])));await read(views);
  expect(f.store.getSyncTelemetry).toHaveBeenCalledTimes(2);expect(Object.keys(f.publish.mock.calls.at(-1)![0])).toHaveLength(views.length);
 });
 it("does not consume shared values or publish after scope disposal",async()=>{
  const f=fixture(),held=deferred<{revision:number}>(),entered=deferred<void>();
  f.store.getSyncTelemetry.mockImplementationOnce(async()=>{entered.resolve();return held.promise;});
  const read=f.make(),coordinator=createHomeOfflineAvailabilityRefresh(canUpdate=>read(views,canUpdate));
  const active=coordinator.request();await entered.promise;coordinator.dispose();held.resolve({revision:1});await active;
  expect(f.publish).not.toHaveBeenCalled();expect(f.store.getAttendanceDaySnapshotHydration).not.toHaveBeenCalled();
 });
});
