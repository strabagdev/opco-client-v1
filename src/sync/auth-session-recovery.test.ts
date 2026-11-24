import {describe,expect,it,vi} from "vitest";
import {OpcoAuthSessionChangedError,type OpcoApi} from "../lib/opco-api";
import type {PendingOperation} from "../lib/offline-records";
import {isSessionLifecycleScopeCurrent,getSessionLifecycleScopeMismatchReason} from "../state/pending-work-lifecycle-logic";
import {syncPendingRecordsOnce,type RecordsSyncStore} from "./records-sync";
import {syncPendingStateUpdatesOnce,type StateUpdateSyncStore} from "./state-update-sync";

function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
function operation(owner:string,state:boolean):PendingOperation{return {id:"op-"+owner,ownerKey:owner,clientRequestId:"request-"+owner,contractId:"contract",entityTypeId:"events",localRecordId:"local-"+owner,serverRecordId:null,operation:state?"STATE_UPDATE":"CREATE",payload:state?{appViewId:"view",subjectRecordId:"subject-"+owner,date:"2026-11-23",stateValues:[{fieldId:"status",value:"A",label:"Synthetic",optionId:null}],extraValues:{context:"synthetic"},expectedUpdatedAt:null}:{values:{name:owner},clientRequestId:"request-"+owner},createdAt:"2026-11-23T00:00:00.000Z",updatedAt:"2026-11-23T00:00:00.000Z",attempts:0,lastErrorCode:null,lastErrorMessage:null} as PendingOperation;}
function fixture(owner:string,state:boolean){
 const op=operation(owner,state);let status="pending_create";
 const completed=vi.fn(async()=>{status="synced";});const retried=vi.fn(async()=>{status="pending_create";});const failed=vi.fn(async()=>{status="failed";});
 const store={listPendingOperations:async(key:string)=>key===owner?[op]:[],listPendingStateUpdateOperations:async(key:string)=>key===owner?[op]:[],markPendingOperationSyncing:async()=>{status="syncing";},markStateUpdateOperationSyncing:async()=>{status="syncing";},completePendingOperation:completed,completeStateUpdateOperation:completed,retryPendingOperation:retried,retryStateUpdateOperation:retried,failPendingOperation:failed,failStateUpdateOperation:failed} as unknown as RecordsSyncStore & StateUpdateSyncStore;
 return{op,store,completed,retried,failed,get status(){return status;}};
}
function ack(owner:string,state:boolean){return state?{appView:{id:"view"},results:[{result:"CREATED",recordId:"remote-"+owner,subjectRecordId:"subject-"+owner,updatedAt:"2026-11-23T12:00:00.000Z"}]}:{record:{id:"remote-"+owner,values:{name:owner},updatedAt:"2026-11-23T12:00:00.000Z"}};}

describe("C08 durable engine classification and ACK scope",()=>{
 it.each([false,true])("retains %s work after obsolete authentication instead of final failure",async state=>{
  const f=fixture("A",state),before=JSON.stringify(f.op);
  const method=vi.fn(async()=>{throw new OpcoAuthSessionChangedError();});
  const api={createEntityRecord:method,saveStateUpdateWorkflow:method,getAuthSessionGeneration:()=>1} as unknown as OpcoApi;
  const result=state?await syncPendingStateUpdatesOnce({api,store:f.store,ownerKey:"A",token:"A"}):await syncPendingRecordsOnce({api,store:f.store,ownerKey:"A",token:"A"});
  expect(result).toMatchObject({completed:0,failed:0,retriable:1});expect(f.status).toBe("pending_create");expect(f.failed).not.toHaveBeenCalled();expect(f.completed).not.toHaveBeenCalled();expect(f.retried).toHaveBeenCalledWith(f.op,"AUTH_SESSION_CHANGED",expect.any(String));expect(JSON.stringify(f.op)).toBe(before);
 });
 it.each([false,true])("waits for a late valid A ACK, then runs B independently for state=%s",async state=>{
  const a=fixture("A",state),b=fixture("B",state),started=deferred<void>(),reply=deferred<unknown>();let generation=0;
  const method=vi.fn(async(token:string)=>{if(token==="A"){started.resolve();return reply.promise;}return ack("B",state);});
  const api={createEntityRecord:method,saveStateUpdateWorkflow:method,getAuthSessionGeneration:()=>generation} as unknown as OpcoApi;
  const run=(f:typeof a,token:string)=>state?syncPendingStateUpdatesOnce({api,store:f.store,ownerKey:token,token}):syncPendingRecordsOnce({api,store:f.store,ownerKey:token,token});
  const first=run(a,"A");await started.promise;generation=1;const next=run(b,"B");
  expect(next).not.toBe(first);expect(method).toHaveBeenCalledTimes(1);reply.resolve(ack("A",state));
  const [ra,rb]=await Promise.all([first,next]);expect(ra.completed).toBe(1);expect(rb.completed).toBe(1);
  expect(a.completed).toHaveBeenCalledWith(a.op,expect.objectContaining(state?{recordId:"remote-A"}:{id:"remote-A"}));
  expect(b.completed).toHaveBeenCalledWith(b.op,expect.objectContaining(state?{recordId:"remote-B"}:{id:"remote-B"}));expect(a.status).toBe("synced");expect(b.status).toBe("synced");
 });
 it("existing lifecycle guard distinguishes generations even for identical owner/token/contract",()=>{
  const scope={ownerKey:"A",token:"same-token",selectedContractId:"contract",authGeneration:1};
  expect(isSessionLifecycleScopeCurrent(scope,{...scope,authGeneration:2})).toBe(false);
  expect(getSessionLifecycleScopeMismatchReason(scope,{...scope,authGeneration:2})).toBe("session_changed");
 });
});
