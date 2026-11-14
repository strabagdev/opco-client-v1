import {describe,it,expect,vi} from "vitest";
import {refreshAttendanceDaySnapshot,cacheAttendanceRemoteSnapshot} from "./attendance-snapshot-cache";
import {completeAttendanceDay} from "./attendance-day-pages";
import {isAttendanceRemoteSnapshotComplete} from "../renderers/workflows/attendance/attendance-workflow-logic";
import {revisionHash,revisionReadPath,type RevisionDownload,type RevisionResource} from "./revision-receipts";
import type {AttendanceResponse} from "./opco-api";
const seed=(count=137)=>({appView:{id:"view",name:"Synthetic",slug:"fixture"},date:"2026-11-12",sourceEntityType:{id:"source",name:"Source"},targetEntityType:{id:"target",name:"Target"},statusFieldId:"state",statuses:[],items:[],latest:Array.from({length:Math.min(10,count)},(_,i)=>event(i)),summary:{totalRegistered:count},daySnapshotCapabilities:{version:1,maxPageSize:100},observationProjection:{version:1,fieldId:"note"}} as AttendanceResponse);
const event=(i:number)=>({attendanceRecordId:"event-"+i,person:{id:"person-"+i,displayName:"Synthetic"},statusLabel:"A",statusOptionId:"a",updatedAt:"2026-11-12T12:00:00.000Z",observation:i%3===0?null:i%3===1?"":"ñ\nExact",contextValues:{group:{optionId:"group",value:"g",label:"Group"}}});
async function page(resource:RevisionResource,total=137,vector="a".repeat(64),mutate?:(data:AttendanceResponse)=>void):Promise<RevisionDownload>{
 const number=Number(resource.query?.page),size=Number(resource.query?.pageSize),base=seed(total);
 const data={...base,items:[],latest:Array.from({length:Math.min(size,Math.max(0,total-(number-1)*size))},(_,i)=>event((number-1)*size+i)),daySnapshot:{version:1 as const,page:number,pageSize:size,total,totalPages:Math.max(1,Math.ceil(total/size)),hasMore:number*size<total}};
 mutate?.(data);
 const entries=[...new URL(revisionReadPath("contract",resource),"http://local.invalid").searchParams.entries()].filter(([k])=>k!=="readRevisionVersion").sort(([a],[b])=>a<b?-1:a>b?1:0);
 const effectiveContext={date:data.date,from:null,to:null},descriptor={kind:"attendance",contractId:"contract",appViewId:"view"};
 const selectionFingerprint=await revisionHash({resource:descriptor,query:entries.filter(([k])=>k!=="page"),effectiveContext});
 return{resource,data,normalized:data,readRevision:{version:1,representationVersion:1,mode:"shadow",reuseAllowed:false,coverageCertified:false,clientMaySkipReads:false,epoch:"epoch",authorizationFingerprint:"b".repeat(64),manifestVectorRevision:vector,selectionFingerprint,requestFingerprint:await revisionHash({resource:descriptor,query:entries,effectiveContext}),revision:await revisionHash({manifestVectorRevision:vector,selectionFingerprint,representationVersion:1}),contentHash:await revisionHash(data),snapshot:{isolation:"repeatable-read",at:"2026-11-12T12:00:00.000Z"}}};
}
const input=(s=seed())=>({seed:s,ownerKey:"org:user",contractId:"contract",appViewId:"view",isCurrent:()=>true});
describe("complete Attendance day downloads",()=>{
 it.each([0,1,10,11,30,137,301])("verifies %i records without changing legacy list size",async count=>{
  const read=vi.fn((r:RevisionResource)=>page(r,count));const result=await completeAttendanceDay({...input(seed(count)),readPage:read});
  expect(isAttendanceRemoteSnapshotComplete(result.response)).toBe(true);expect(result.response.latest).toHaveLength(count);
  expect(read).toHaveBeenCalledTimes(count<=10?0:Math.ceil(count/100));
  if(count>100)expect(read.mock.calls[1][0].query?.page).toBe("2");
  if(count>10){expect(isAttendanceRemoteSnapshotComplete({...result.response})).toBe(false);expect(Object.isFrozen(result.response.latest[0])).toBe(true);}
 });
 it("rejects normalized values that diverge from the sealed body",async()=>{
  await expect(completeAttendanceDay({...input(),readPage:async r=>{const d=await page(r);d.normalized=JSON.parse(JSON.stringify(d.data));(d.normalized as AttendanceResponse).latest[0].observation="Changed after seal";return d;}})).rejects.toThrow("READ_REVISION_CONTENT_MISMATCH");
 });
 it("persists the full day while returning the legacy bounded DTO to the renderer",async()=>{
  const initial=seed(),store={upsertStateUpdateSnapshot:vi.fn(async(input:{expectedRemoteEventCount?:number})=>({contentVerified:input.expectedRemoteEventCount===137,staleSyncedRemoved:0})),markAttendanceDaySnapshotHydrated:vi.fn(async()=>{})};
  const result=await refreshAttendanceDaySnapshot({ownerKey:"org:user",contractId:"contract",appViewId:"view",config:{statusFieldId:"state"},date:initial.date,token:"synthetic",isCurrent:()=>true,store,
    api:{getAttendanceWorkflow:async()=>initial,getRevisionRead:async(_token,_contract,r)=>page(r)}});
  expect(result?.response).toBe(initial);expect(result?.response.latest).toHaveLength(10);expect(store.upsertStateUpdateSnapshot.mock.calls[0][0]).toMatchObject({complete:true,expectedRemoteEventCount:137});
 });
 it("binds the in-memory full-day proof to owner, contract and AppView",async()=>{
  const {response}=await completeAttendanceDay({...input(),readPage:r=>page(r)});
  for(const changed of[{ownerKey:"other:user"},{contractId:"other"},{appViewId:"other"}]){
   await expect(completeAttendanceDay({...input(response),...changed,readPage:r=>page(r)})).rejects.toThrow("REVISION_SCOPE_MISMATCH");
   const store={upsertStateUpdateSnapshot:vi.fn(),markAttendanceDaySnapshotHydrated:vi.fn()};
   await expect(cacheAttendanceRemoteSnapshot({ownerKey:"org:user",contractId:"contract",appViewId:"view",...changed,config:{statusFieldId:"state"},response,store})).rejects.toThrow("REVISION_SCOPE_MISMATCH");expect(store.upsertStateUpdateSnapshot).not.toHaveBeenCalled();
  }
 });
 it("passes the first revision to the next page",async()=>{
  const read=vi.fn(async(r:RevisionResource,expected?:string)=>{const d=await page(r);if(r.query?.page==="2")expect(expected).toBe(d.readRevision.revision);return d;});
  await completeAttendanceDay({...input(),readPage:read});
 });
 it.each(["missing","duplicate","unknownVersion","wrongDate","wrongTotal","wrongContext","wrongSize"])("rejects malformed page %s",async kind=>{
  await expect(completeAttendanceDay({...input(),readPage:r=>page(r,137,undefined,d=>{
   if(kind==="missing")d.latest.pop();if(kind==="duplicate")d.latest[1]=d.latest[0];
   if(kind==="unknownVersion")d.daySnapshot!.version=2 as never;if(kind==="wrongDate")d.date="2026-11-13";
   if(kind==="wrongTotal")d.daySnapshot!.total=138;if(kind==="wrongContext")d.contextFields=[];
   if(kind==="wrongSize")d.daySnapshot!.pageSize=99;
  })})).rejects.toThrow();
 });
 it("rejects mixed data/metadata/authorization revisions and retired scope",async()=>{
  await expect(completeAttendanceDay({...input(),readPage:r=>page(r,137,r.query?.page==="1"?"a".repeat(64):"c".repeat(64))})).rejects.toThrow("REVISION_PAGES_MIXED");
  let current=true;await expect(completeAttendanceDay({...input(),isCurrent:()=>current,readPage:async r=>{current=false;return page(r);}})).rejects.toThrow("REVISION_SCOPE_RETIRED");
 });
 it("propagates interruption and 409 without fallback or partial complete marker",async()=>{
  const read=vi.fn(async(r:RevisionResource)=>{if(r.query?.page==="2")throw Object.assign(Error("READ_REVISION_CHANGED"),{status:409});return page(r);});
  await expect(completeAttendanceDay({...input(),readPage:read})).rejects.toMatchObject({status:409});expect(read).toHaveBeenCalledTimes(2);expect(isAttendanceRemoteSnapshotComplete(seed())).toBe(false);
 });
 it("retains explicit legacy limitation and rejects unsupported advertised metadata",async()=>{
  const old=seed();delete old.daySnapshotCapabilities;const read=vi.fn();const result=await completeAttendanceDay({...input(old),readPage:read});expect(result.response).toBe(old);expect(isAttendanceRemoteSnapshotComplete(old)).toBe(false);expect(read).not.toHaveBeenCalled();
  const future=seed();future.daySnapshotCapabilities!.version=2 as never;await expect(completeAttendanceDay({...input(future),readPage:read})).rejects.toThrow("ATTENDANCE_DAY_INCOMPATIBLE");
 });
});
