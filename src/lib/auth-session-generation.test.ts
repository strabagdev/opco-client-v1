import {describe,expect,it,vi} from "vitest";
import {createOpcoApi,OpcoAuthSessionChangedError} from "./opco-api";
import {restoreSession} from "./session-logic";

const response=(data:unknown,status=200)=>new Response(JSON.stringify(status<400?{ok:true,data}:{ok:false,error:data}),{status});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
function fixture(sameToken=false){
  let stored:string|null=null,serial=0;
  const calls:{path:string;token:string|null;body:string|undefined}[]=[];
  const callbacks={invalid:vi.fn(),refreshed:vi.fn()};
  const store={getRefreshToken:async()=>"synthetic-refresh",clearSession:vi.fn(async()=>{stored=null;}),setSession:vi.fn(async(value:{accessToken:string})=>{stored=value.accessToken;})};
  let action:(path:string,init:RequestInit)=>Promise<Response>=async()=>response({record:{id:"record-a",updatedAt:"2026-11-23T12:00:00.000Z",values:{}}});
  const api=createOpcoApi({apiUrl:"https://synthetic.invalid",platformOS:"web",tokenStore:store,onSessionInvalid:callbacks.invalid,onSessionRefreshed:callbacks.refreshed,fetcher:async(url,init={})=>{
    const path=new URL(String(url)).pathname,headers=new Headers(init.headers);
    calls.push({path,token:headers.get("Authorization"),body:init.body?.toString()});
    if(path.endsWith("/auth/login")){const user=JSON.parse(String(init.body)).email;return response({accessToken:user+(sameToken?"":"-"+(++serial)),tokenType:"Bearer",expiresIn:3600});}
    if(path.endsWith("/auth/logout"))return response({});
    return action(path,init);
  }});
  async function login(user:string){const result=await api.login(user,"synthetic-only");if(!("accessToken"in result))throw Error("fixture login");await api.commitAuthSession(api.getAuthSessionGeneration(),()=>store.setSession(result));return result.accessToken;}
  return{api,store,calls,callbacks,login,get stored(){return stored;},setAction(fn:typeof action){action=fn;}};
}

describe("C08 auth generation",()=>{
  it("bootstrap cannot clear or restore a different login after its old /me response",async()=>{
    const f=fixture(),reply=deferred<Response>(),a=await f.login("A");f.setAction(async()=>reply.promise);
    const pending=restoreSession({clearSession:f.store.clearSession,getAccessToken:async()=>f.stored,getSessionOwnerKey:async()=>"org:A"},f.api).catch(e=>e);
    // Token/owner reads in bootstrap are asynchronous; wait for its actual /me dispatch.
    const dispatched=deferred<void>();f.setAction(async()=>{dispatched.resolve();return reply.promise;});await dispatched.promise;
    const b=await f.login("B");reply.resolve(response({code:"TOKEN_INVALID",message:"retired bootstrap"},401));
    expect(await pending).toBeInstanceOf(OpcoAuthSessionChangedError);expect(f.stored).toBe(b);expect(f.store.clearSession).not.toHaveBeenCalled();expect(a).not.toBe(b);
  });
  it.each([[401,"TOKEN_EXPIRED"],[401,"TOKEN_INVALID"],[403,"FORBIDDEN"]] as const)("rejects stale %s/%s without refreshing or clearing B",async(status,code)=>{
    const f=fixture(),reply=deferred<Response>(),a=await f.login("A");f.setAction(async()=>reply.promise);
    const pending=f.api.createEntityRecord(a,"contract","entity",{clientRequestId:"stable-command",values:{name:"A"}}).catch(e=>e);
    const b=await f.login("B");reply.resolve(response({code,message:"synthetic auth error"},status));
    expect(await pending).toBeInstanceOf(OpcoAuthSessionChangedError);expect(f.stored).toBe(b);
    expect(f.store.clearSession).not.toHaveBeenCalled();expect(f.callbacks.invalid).not.toHaveBeenCalled();
    expect(f.calls.filter(c=>c.path.endsWith("/auth/refresh"))).toHaveLength(0);
    expect(f.calls.filter(c=>c.path.endsWith("/records"))).toHaveLength(1);
  });
  it("A logout A does not revive a request even when access token bytes are identical",async()=>{
    const f=fixture(true),reply=deferred<Response>(),a=await f.login("A"),original=f.api.getAuthSessionGeneration();f.setAction(async()=>reply.promise);
    const pending=f.api.getMe(a).catch(e=>e);await f.api.logout();const a2=await f.login("A");expect(a2).toBe(a);expect(f.api.getAuthSessionGeneration()).not.toBe(original);
    reply.resolve(response({code:"TOKEN_INVALID",message:"old A"},401));expect(await pending).toBeInstanceOf(OpcoAuthSessionChangedError);
    expect(f.stored).toBe(a2);expect(f.store.clearSession).not.toHaveBeenCalled();
  });
  it.each([200,401])("cancels an old refresh before its %s response can mutate B",async(status)=>{
    const f=fixture(),reply=deferred<Response>(),started=deferred<void>(),a=await f.login("A");let signal:AbortSignal|undefined;
    f.setAction(async(path,init)=>{if(path.endsWith("/auth/refresh")){signal=init.signal as AbortSignal;started.resolve();return reply.promise;}return response({code:"TOKEN_EXPIRED",message:"expired A"},401);});
    const pending=f.api.getMe(a).catch(e=>e);await started.promise;const b=await f.login("B");
    reply.resolve(status===200?response({accessToken:"A-refresh",expiresIn:3600,tokenType:"Bearer"}):response({code:"REFRESH_TOKEN_REVOKED",message:"old refresh"},401));
    expect(await pending).toBeInstanceOf(OpcoAuthSessionChangedError);expect(signal?.aborted).toBe(true);
    expect(f.stored).toBe(b);expect(f.callbacks.refreshed).not.toHaveBeenCalled();expect(f.callbacks.invalid).not.toHaveBeenCalled();
    expect(f.store.setSession.mock.calls.map(([v])=>v.accessToken)).not.toContain("A-refresh");
  });
  it("serializes an already-started async credential write before the newer login commit",async()=>{
    const f=fixture(),started=deferred<void>(),finish=deferred<void>(),a=await f.login("A");let writes=0;
    const original=f.store.setSession.getMockImplementation()!;
    f.store.setSession.mockImplementation(async value=>{if(value.accessToken==="A-refresh"){started.resolve();await finish.promise;}writes++;await original(value);});
    f.setAction(async path=>path.endsWith("/auth/refresh")?response({accessToken:"A-refresh",expiresIn:3600,tokenType:"Bearer"}):response({code:"TOKEN_EXPIRED",message:"expired"},401));
    const pending=f.api.getMe(a).catch(e=>e);await started.promise;
    const login=f.api.login("B","synthetic-only");const value=await login;if(!("accessToken"in value))throw Error("fixture");
    const committed=f.api.commitAuthSession(f.api.getAuthSessionGeneration(),()=>f.store.setSession(value));
    expect(writes).toBe(0);finish.resolve();await committed;
    expect(await pending).toBeInstanceOf(OpcoAuthSessionChangedError);expect(f.stored).toBe(value.accessToken);expect(f.callbacks.refreshed).not.toHaveBeenCalled();
  });
  it("returns a valid late write ACK without applying auth effects to B",async()=>{
    const f=fixture(),reply=deferred<Response>(),a=await f.login("A");f.setAction(async()=>reply.promise);
    const pending=f.api.createEntityRecord(a,"contract","entity",{clientRequestId:"stable",values:{name:"A"}});const b=await f.login("B");
    reply.resolve(response({record:{id:"accepted-a",updatedAt:"2026-11-23T12:00:00.000Z",values:{name:"A"}}}));
    expect((await pending).record.id).toBe("accepted-a");expect(f.stored).toBe(b);expect(f.callbacks.invalid).not.toHaveBeenCalled();
  });
  it("does not start requests with a retired token, and permits later recovery by A",async()=>{
    const f=fixture(),a=await f.login("A");await f.login("B");const n=f.calls.length;
    await expect(f.api.createEntityRecord(a,"contract","entity",{clientRequestId:"same",values:{name:"A"}})).rejects.toBeInstanceOf(OpcoAuthSessionChangedError);expect(f.calls).toHaveLength(n);
    const a2=await f.login("A");await f.api.createEntityRecord(a2,"contract","entity",{clientRequestId:"same",values:{name:"A"}});
    expect(f.calls.at(-1)?.token).toBe("Bearer "+a2);expect(JSON.parse(f.calls.at(-1)!.body!)).toEqual({clientRequestId:"same",values:{name:"A"}});
  });
});
