// @ts-expect-error Node types are intentionally absent from the Expo app.
import {readFileSync} from "node:fs";
// @ts-expect-error Node types are intentionally absent from the Expo app.
import {createRequire} from "node:module";
import {afterAll,beforeAll,describe,expect,it}from"vitest";
import {createOpcoApi}from"./opco-api";
const enabled=process.env.ATTENDANCE_REPETITION_HTTP==="1",suite=enabled?describe.sequential:describe.skip;
const newOrigin="http://127.0.0.1:25535",oldOrigin="http://127.0.0.1:25534";
const f=enabled?JSON.parse(readFileSync(process.env.ATTENDANCE_REPETITION_HTTP_FIXTURE??"","utf8")):null;
let testDatabase: {apiIdempotencyKey: {deleteMany:(v:unknown)=>Promise<unknown>};auditEvent:{deleteMany:(v:unknown)=>Promise<unknown>};entityRecord:{deleteMany:(v:unknown)=>Promise<unknown>};$disconnect:()=>Promise<void>}|undefined;
async function clearOwnTargets(){if(testDatabase){await testDatabase.apiIdempotencyKey.deleteMany({where:{contractId:f.contract}});await testDatabase.auditEvent.deleteMany({where:{contractId:f.contract}});await testDatabase.entityRecord.deleteMany({where:{entityTypeId:{in:Object.values(f.views).map((v)=> (v as {target:string}).target)}}});}}
let token="";const prefix="http-review-"+Date.now(),day="2026-11-17",api=createOpcoApi({apiUrl:newOrigin,platformOS:"web"});
const body=(kind:string,key:string)=>{const v=f.views[kind];return{clientRequestId:prefix+key,subjectRecordId:f.person,date:day,states:{[v.state]:v.a},extraValues:{[v.context]:f.lot1,[v.select]:"north"}};};
async function post(origin:string,kind:string,key:string,more:Record<string,unknown>={},path="state-update"){const res=await fetch(`${origin}/api/v1/contracts/${f.contract}/views/${f.views[kind].id}/workflow/${path}`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({...body(kind,key),...more})});return{status:res.status,value:await res.json()};}
async function read(kind:string){return api.getAttendanceWorkflow(token,f.contract,f.views[kind].id,{date:day,personRecordId:f.person});}
suite("real HTTP compatibility: full previous and candidate Next Core",()=>{
 beforeAll(async()=>{
 const dbUrl=new URL(process.env.DATABASE_URL??"");if(dbUrl.hostname!=="127.0.0.1"||dbUrl.port!=="25432"||dbUrl.pathname!=="/repetition_test"||dbUrl.username!=="repetition_owner"||f.org!=="repeat_review_org")throw Error("Isolated fixture/database required");
 const req=createRequire(process.env.ATTENDANCE_REPETITION_HTTP_CORE_PACKAGE??"");const {PrismaClient}=req("@prisma/client");testDatabase=new PrismaClient();await clearOwnTargets();const res=await fetch(newOrigin+"/api/v1/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:"repeat-review@example.invalid",password:"Synthetic-Repeat-Only-2026",clientId:"repetition-review-client"})});const result=await res.json();expect(res.status).toBe(200);token=result.data.accessToken;expect(typeof token).toBe("string");});
 afterAll(async()=>{await clearOwnTargets();await testDatabase?.$disconnect();});
 it("new Client and old Client preserve default writes and retry identity across Core update",async()=>{
  const first=await post(oldOrigin,"single","default-upgrade");expect(first.status).toBe(200);expect(first.value.data.result.result).toBe("CREATED");
  const repeat=await post(newOrigin,"single","default-upgrade");expect(repeat.status).toBe(200);expect(repeat.value.data.result.recordId).toBe(first.value.data.result.recordId);
  const explicit=await post(newOrigin,"single","default-upgrade",{repetitionPolicy:"ONE_PER_DAY"});expect(explicit.status).toBe(200);expect(explicit.value.data.result.recordId).toBe(first.value.data.result.recordId);
  const oldApi=createOpcoApi({apiUrl:oldOrigin,platformOS:"web"}),v=f.views.single;
  const same=await oldApi.saveStateUpdateWorkflow(token,f.contract,v.id,{clientRequestId:prefix+"new-client-default",subjectRecordId:f.person,date:day,stateValues:[{fieldId:v.state,optionId:v.a}],extraValues:{[v.context]:f.lot1,[v.select]:"north"}});
  expect(same.results[0]).toMatchObject({result:"UNCHANGED",recordId:first.value.data.result.recordId});expect((await read("single")).summary.totalRegistered).toBe(1);
 });
 it("new Core rejects legacy commands for multiple without changing data",async()=>{
  const before=(await read("multiple")).summary.totalRegistered;
  const legacy=await post(newOrigin,"multiple","legacy-body");expect(legacy.status).toBe(400);expect(legacy.value.error.code).toBe("ATTENDANCE_POLICY_CHANGED");
  const endpoint=await fetch(`${newOrigin}/api/v1/contracts/${f.contract}/views/${f.views.multiple.id}/workflow/attendance`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({date:day,clientRequestId:prefix+"legacy-batch",entries:[{personRecordId:f.person,statusOptionId:f.views.multiple.a}]})});expect(endpoint.status).toBe(400);expect((await endpoint.json()).error.code).toBe("ATTENDANCE_REPETITION_COMMAND_REQUIRED");
  expect((await read("multiple")).summary.totalRegistered).toBe(before);
 });
 it("rollback after compatible GET cannot send creation or selected edit through old Core",async()=>{
  const v=f.views.multiple,proof=await api.getStateUpdateWorkflow(token,f.contract,v.id,{date:day,subjectRecordId:f.person});expect(proof.repetitionPolicy).toBe("MULTIPLE");
  const paths:string[]=[],rolled=createOpcoApi({apiUrl:newOrigin,platformOS:"web",fetcher:async(url,init)=>{const u=new URL(String(url));if(init?.method==="POST"){paths.push(u.pathname);u.port="25534";}return fetch(u,init);}});
  for(const editing of [false,true])await expect(rolled.saveStateUpdateWorkflow(token,f.contract,v.id,{clientRequestId:prefix+"rolled-"+editing,subjectRecordId:f.person,date:day,repetitionPolicy:"MULTIPLE",stateValues:[{fieldId:v.state,optionId:v.a}],extraValues:{[v.context]:f.lot1,[v.select]:"north"},...(editing?{targetRecordId:"selected-id",expectedUpdatedAt:"2026-11-17T10:00:00.000Z",overwrite:true}:{})})).rejects.toMatchObject({status:404,code:"ATTENDANCE_POLICY_UNVERIFIED"});
  expect(paths).toHaveLength(2);expect(paths.every(p=>p.endsWith("/state-update/repetition"))).toBe(true);expect((await read("multiple")).summary.totalRegistered).toBe(0);
 });
 it("new path preserves two intentional events, idempotency and an exact old-event edit",async()=>{
  const v=f.views.multiple,command={clientRequestId:prefix+"event-one",subjectRecordId:f.person,date:day,repetitionPolicy:"MULTIPLE" as const,eventOccurredAt:"2026-11-17T10:00:00.000Z",stateValues:[{fieldId:v.state,optionId:v.a}],extraValues:{[v.context]:f.lot1,[v.select]:"north"}};
  const first=(await api.saveStateUpdateWorkflow(token,f.contract,v.id,command)).results[0];expect(first.result).toBe("CREATED");if(!("recordId"in first))throw Error("No record");
  expect((await api.saveStateUpdateWorkflow(token,f.contract,v.id,command)).results[0]).toEqual(first);
  const second=(await api.saveStateUpdateWorkflow(token,f.contract,v.id,{...command,clientRequestId:prefix+"event-two",extraValues:{[v.context]:f.lot2,[v.select]:"north"}})).results[0];if(!("recordId"in second))throw Error("No second record");expect(second.recordId).not.toBe(first.recordId);
  const updated=(await api.saveStateUpdateWorkflow(token,f.contract,v.id,{...command,clientRequestId:prefix+"edit-first",targetRecordId:first.recordId,expectedUpdatedAt:first.updatedAt,overwrite:true,stateValues:[{fieldId:v.state,optionId:v.b}]})).results[0];expect(updated).toMatchObject({result:"UPDATED",recordId:first.recordId});
  const records=(await read("multiple")).dailyRecords!;expect(records).toHaveLength(2);expect(records.find(r=>r.attendance?.recordId===first.recordId)?.attendance).toMatchObject({statusOptionId:v.b,contextValues:{[v.context]:{id:f.lot1}}});expect(records.find(r=>r.attendance?.recordId===second.recordId)?.attendance).toMatchObject({statusOptionId:v.a,contextValues:{[v.context]:{id:f.lot2}}});
 });
 it("new route uses the existing CORS policy",async()=>{const res=await fetch(`${newOrigin}/api/v1/contracts/${f.contract}/views/${f.views.multiple.id}/workflow/state-update/repetition`,{method:"OPTIONS",headers:{Origin:"http://127.0.0.1:25536","Access-Control-Request-Method":"POST","Access-Control-Request-Headers":"authorization,content-type"}});expect(res.status).toBe(204);expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:25536");});
 it("characterizes why sending a repeat body to legacy POST is unsafe",async()=>{
  const v=f.views.multiple,more={subjectRecordId:f.person2,repetitionPolicy:"MULTIPLE"};
  const first=await post(oldOrigin,"multiple","unsafe-v1-first",more),second=await post(oldOrigin,"multiple","unsafe-v1-second",more);
  expect(first.value.data.result.result).toBe("CREATED");expect(second.value.data.result.result).toBe("UNCHANGED");expect(second.value.data.result.recordId).toBe(first.value.data.result.recordId);
  const response=await api.getAttendanceWorkflow(token,f.contract,v.id,{date:day,personRecordId:f.person2});expect(response.dailyRecords).toHaveLength(1);
 });

});
