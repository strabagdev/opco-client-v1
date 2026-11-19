import {describe,it,expect,vi} from "vitest";
import {createOpcoApi} from "./opco-api";
import {operationalCalendarKey,type OperationalCalendar} from "./operational-calendar";
import {PANEL_ACCEPT} from "./panel-compatibility";
const calendar:OperationalCalendar={version:1,timeZone:"America/Santiago",dayStart:"08:00",bands:[]};
const command={clientRequestId:"original",date:"2026-11-18",subjectRecordId:"subject",stateValues:[{fieldId:"state",optionId:"b"}],eventOccurredAt:"2026-11-19T05:00:00.123Z",operationalDay:{version:1 as const,calendarKey:operationalCalendarKey(calendar),mode:"AUTO" as const}};
describe("operational calendar transport compatibility",()=>{
 it.each([404,405])("never falls back to a legacy writer when Core responds %i",async status=>{
   const fetcher=vi.fn(async(_url:string|URL|Request,_init?:RequestInit)=>Response.json({ok:false,error:{code:"NOT_FOUND",message:"Old Core"}},{status}));
   const api=createOpcoApi({apiUrl:"https://synthetic.invalid",fetcher});
   await expect(api.saveStateUpdateWorkflow("synthetic","contract","view",command)).rejects.toMatchObject({code:"OPERATIONAL_DAY_UNSUPPORTED"});
   expect(fetcher).toHaveBeenCalledOnce();const[url,init]=fetcher.mock.calls[0]as unknown as[string,RequestInit];expect(String(url).endsWith("/workflow/state-update/operational-day")).toBe(true);expect(JSON.parse(String(init.body))).toMatchObject({eventOccurredAt:command.eventOccurredAt,operationalDay:command.operationalDay,date:command.date});
 });
 it("uses the existing compact Accept capability for ordinary and revision Attendance reads",async()=>{
  const fetcher=vi.fn(async(_url:string|URL|Request,_init?:RequestInit)=>Response.json({ok:false,error:{code:"UNAVAILABLE",message:"Synthetic probe"}},{status:409}));const api=createOpcoApi({apiUrl:"https://synthetic.invalid",fetcher});await api.getAttendanceWorkflow("synthetic","contract","view",{date:"2026-11-18"}).catch(()=>undefined);
  const init=fetcher.mock.calls[0]?.[1]as unknown as RequestInit;expect(new Headers(init.headers).get("Accept")).toBe(PANEL_ACCEPT);expect(PANEL_ACCEPT.length).toBeLessThanOrEqual(128);expect(new Headers(init.headers).has("X-Opco-Operational-Day")).toBe(false);
 });
});
