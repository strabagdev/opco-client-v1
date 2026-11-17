import { describe, expect, it, vi } from "vitest";
import { createOpcoApi, type StateUpdateRequest } from "./opco-api";

const command = (): StateUpdateRequest => ({subjectRecordId:"subject",date:"2026-11-17",clientRequestId:"repeat-intent",repetitionPolicy:"MULTIPLE",stateValues:[{fieldId:"state",optionId:"a"}],extraValues:{lot:"lot-id"}});
const reply = () => new Response(JSON.stringify({ok:true,data:{appView:{id:"view",name:"Synthetic",slug:"synthetic"},result:{result:"UNCHANGED",recordId:"prior-record",subjectRecordId:"subject",updatedAt:"2026-11-17T10:00:00.000Z"}}}),{status:200,headers:{"Content-Type":"application/json"}});

describe("Attendance command transport across Core versions",()=>{
  it.each([false,true])("never reaches legacy one-per-day after a backend rollback; edit=%s",async edit=>{
    const paths:string[]=[];let legacyExecutions=0;
    const api=createOpcoApi({apiUrl:"https://synthetic.invalid",fetcher:async(url)=>{
      const path=new URL(String(url)).pathname;paths.push(path);
      if(path.endsWith("/state-update/repetition"))return new Response(JSON.stringify({ok:false,error:{code:"NOT_FOUND",message:"Old Core route"}}),{status:404,headers:{"Content-Type":"application/json"}});
      legacyExecutions++;return reply();
    }});
    await expect(api.saveStateUpdateWorkflow("synthetic","contract","view",{...command(),...(edit?{targetRecordId:"selected-old",expectedUpdatedAt:"2026-11-17T10:00:00.000Z",overwrite:true}:{})})).rejects.toMatchObject({status:404});
    expect(legacyExecutions).toBe(0);expect(paths).toEqual(["/api/v1/contracts/contract/views/view/workflow/state-update/repetition"]);
  });
  it.each(["MULTIPLE","MULTIPLE_WITH_WARNING"] as const)("serializes %s with the fail-closed route and sanitized diagnostics",async repetitionPolicy=>{
    const diagnostics=vi.fn(),requests:{url:string;body:unknown}[]=[];
    const api=createOpcoApi({apiUrl:"https://synthetic.invalid",onRequestDiagnostics:diagnostics,fetcher:async(url,init)=>{requests.push({url:String(url),body:JSON.parse(String(init?.body))});return reply();}});
    await api.saveStateUpdateWorkflow("synthetic","contract","view",{...command(),repetitionPolicy,repetitionAcknowledged:true});
    expect(requests[0].url).toContain("/state-update/repetition");expect(requests[0].body).toMatchObject({repetitionPolicy,repetitionAcknowledged:true,states:{state:"a"},extraValues:{lot:"lot-id"},clientRequestId:"repeat-intent"});
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({pathTemplate:"/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update/repetition"}));
  });
  it.each([undefined,"ONE_PER_DAY"] as const)("retains the old request route for default policy %s",async repetitionPolicy=>{
    const paths:string[]=[],bodies:unknown[]=[];const api=createOpcoApi({apiUrl:"https://synthetic.invalid",fetcher:async(url,init)=>{paths.push(String(url));bodies.push(JSON.parse(String(init?.body)));return reply();}});
    const {repetitionPolicy:_,...base}=command();void _;
    await api.saveStateUpdateWorkflow("synthetic","contract","view",{...base,...(repetitionPolicy?{repetitionPolicy}:{})});
    expect(paths).toEqual(["https://synthetic.invalid/api/v1/contracts/contract/views/view/workflow/state-update"]);expect(bodies[0]).not.toHaveProperty("repetitionPolicy");
  });
  it.each([{targetRecordId:"retained-id"},{eventOccurredAt:"2026-11-17T10:00:00.000Z"},{repetitionAcknowledged:true}])("rejects partial repetition metadata without its policy: %o",async metadata=>{
    const fetcher=vi.fn(async()=>reply()),api=createOpcoApi({apiUrl:"https://synthetic.invalid",fetcher});
    const {repetitionPolicy:_,...base}=command();void _;
    await expect(api.saveStateUpdateWorkflow("synthetic","contract","view",{...base,...metadata})).rejects.toMatchObject({code:"ATTENDANCE_POLICY_UNVERIFIED"});
    expect(fetcher).not.toHaveBeenCalled();
  });
});
