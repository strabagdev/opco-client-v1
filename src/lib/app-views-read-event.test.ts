import {describe,expect,it,vi} from "vitest";
import {appViewsAuthorizationScope,createAppViewsReadEvent,loadAppViewsWithCache} from "./app-navigation-cache";
import {OpcoApiError,type AppView,type ContextResponse,type MeResponse} from "./opco-api";

const view=(id:string)=>({id,name:id,slug:id,type:"RECORDS",icon:null,sortOrder:0,config:{entityTypeId:"entity"}} as AppView);
const me={app:{id:"app",clientId:"client",name:"App",slug:"app"},user:{id:"user",email:"synthetic@example.invalid",name:"Synthetic"}} satisfies MeResponse;
const context={organization:{id:"org",name:"Org"},contracts:[{id:"contract",name:"Contract",role:"ADMIN"}]} satisfies ContextResponse;
function fixture(){
 let views=[view("assigned")];
 const api={getAppViews:vi.fn(async()=>({views}))};
 const cache={getAppViews:vi.fn(async()=>({views:[view("old")],syncedAt:"2026-11-11T00:00:00Z"})),upsertAppViews:vi.fn(async()=>undefined)};
 const input={api,cache,ownerKey:"org:user",contractId:"contract",token:"synthetic-token",authorizationScope:appViewsAuthorizationScope(me,context)};
 return{api,cache,input,event:()=>createAppViewsReadEvent({...input,invalidationKey:"resume-1"}),setViews:(next:AppView[])=>{views=next;}};
}
describe("one lifecycle event shared with Home",()=>{
 it("shares a completed remote read and persistence only for the same explicit event",async()=>{
  const f=fixture(),event=f.event();
  const lifecycle=await loadAppViewsWithCache({...f.input,readEvent:event});await lifecycle.cacheWrite;
  const onCached=vi.fn();const home=await loadAppViewsWithCache({...f.input,readEvent:event,onCached});await home.cacheWrite;
  expect(home.views).toEqual([view("assigned")]);expect(f.api.getAppViews).toHaveBeenCalledTimes(1);expect(f.cache.upsertAppViews).toHaveBeenCalledTimes(1);
  expect(onCached).not.toHaveBeenCalled(); // No flash of revoked/older assignments after remote authorization.
  await loadAppViewsWithCache(f.input); // Later mount/navigation/manual refresh has no handoff.
  expect(f.api.getAppViews).toHaveBeenCalledTimes(2);
  f.setViews([view("newer")]);
  expect((await loadAppViewsWithCache({...f.input,readEvent:event})).views).toEqual([view("newer")]);
  expect(f.api.getAppViews).toHaveBeenCalledTimes(3); // A retired handoff cannot replay an older list.
 });
 it("shares an active event and still fetches again for the next event with changed assignments",async()=>{
  const f=fixture();let release!:()=>void;const held=new Promise<void>(r=>{release=r;});
  f.api.getAppViews.mockImplementationOnce(async()=>{await held;return{views:[view("assigned")]};});
  const event=f.event();const one=loadAppViewsWithCache({...f.input,readEvent:event});const two=loadAppViewsWithCache({...f.input,readEvent:event});
  expect(f.api.getAppViews).toHaveBeenCalledTimes(1);release();await Promise.all([one,two]);
  f.setViews([]);const next=createAppViewsReadEvent({...f.input,invalidationKey:"resume-2"});
  expect((await loadAppViewsWithCache({...f.input,readEvent:next})).views).toEqual([]);
  expect(f.api.getAppViews).toHaveBeenCalledTimes(2);
 });
 it.each(["owner","contract","token","permissions","api","cache","unknown-permissions"])("does not share across incompatible %s",async(change)=>{
  const f=fixture(),event=f.event();await loadAppViewsWithCache({...f.input,readEvent:event});
  const alternate={...f.input};
  if(change==="owner")alternate.ownerKey="org:other";
  if(change==="contract")alternate.contractId="other";
  if(change==="token")alternate.token="new-token";
  if(change==="permissions")alternate.authorizationScope=appViewsAuthorizationScope(me,{...context,contracts:[{...context.contracts[0],role:"MEMBER"}]});
  if(change==="unknown-permissions")alternate.authorizationScope=null;
  if(change==="api")alternate.api={getAppViews:vi.fn(async()=>({views:[view("other-api")]}))};
  if(change==="cache")alternate.cache={getAppViews:vi.fn(async()=>null),upsertAppViews:vi.fn(async()=>undefined)} as never;
  await loadAppViewsWithCache({...alternate,readEvent:event});
  expect(alternate.api.getAppViews).toHaveBeenCalledTimes(change==="api"?1:2);
 });
 it("does not turn an authorization failure into cached success or reuse it in a later event",async()=>{
  const f=fixture(),error=new OpcoApiError("Access revoked","APP_VIEW_FORBIDDEN",403);
  f.api.getAppViews.mockRejectedValueOnce(error);const event=f.event();
  await expect(loadAppViewsWithCache({...f.input,readEvent:event})).rejects.toBe(error);
  expect(f.cache.upsertAppViews).not.toHaveBeenCalled();
  await expect(loadAppViewsWithCache({...f.input,readEvent:event})).rejects.toBe(error);
  const next=createAppViewsReadEvent({...f.input,invalidationKey:"later-validated-event"});
  expect((await loadAppViewsWithCache({...f.input,readEvent:next})).offline).toBe(false);
  expect(f.api.getAppViews).toHaveBeenCalledTimes(2);
 });
});
