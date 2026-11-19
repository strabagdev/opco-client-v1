import {describe,it,expect} from "vitest";
import {finalizeAttendanceDay} from "./attendance-operational-day";
import {operationalCalendarKey, type OperationalCalendar} from "./operational-calendar";
const calendar:OperationalCalendar={version:1,timeZone:"America/Santiago",dayStart:"08:00",bands:[{optionId:"option-a",start:"08:00",end:"20:00"},{optionId:"option-b",start:"20:00",end:"08:00"}]};
const contract={version:1 as const,calendarKey:operationalCalendarKey(calendar)};
const input={calendar,contract,date:"2026-11-18",mode:"AUTO" as const,editing:false,instant:"2026-11-19T05:00:00.123Z"};
describe("Definitive Attendance operational confirmation",()=>{
 it("leaves unconfigured consumers unchanged",()=>{const entry={statusOptionId:"option-a"};expect(finalizeAttendanceDay(entry,{...input,calendar:undefined}).entry).toBe(entry);});
 it("uses the definitive click, keeps manual SELECT and reports its mismatch once",()=>{const entry={statusOptionId:"option-a"};const r=finalizeAttendanceDay(entry,input);expect(r.entry).toMatchObject({statusOptionId:"option-a",eventOccurredAt:input.instant,operationalDay:{mode:"AUTO"}});expect(r.notice).toContain("conservó tu selección manual");});
 it("a warning crossing 20:00 uses its final confirmation instant, not the opening time",()=>{
  const entry={statusOptionId:"option-a"}; // Warning opening/cancellation has no finalizer, timestamp or outbox write.
  expect(entry).not.toHaveProperty("eventOccurredAt");
  const r=finalizeAttendanceDay(entry,{...input,instant:"2026-11-18T23:00:00.000Z"});
  expect(r.entry.eventOccurredAt).toBe("2026-11-18T23:00:00.000Z");expect(r.notice).toContain("franja");
 });
 it("requires a new explicit confirmation when an automatic warning crosses the day boundary",()=>{expect(()=>finalizeAttendanceDay({statusOptionId:"option-b"},{...input,instant:"2026-11-19T11:00:00.000Z"})).toThrow("Cambió el día operativo");});
 it("keeps a retrospective manual DATE and never infers its historical band",()=>{const r=finalizeAttendanceDay({statusOptionId:"option-a"},{...input,date:"2026-10-01",mode:"MANUAL"});expect(r.entry.operationalDay?.mode).toBe("MANUAL");expect(r.notice).toContain("no se dedujo");});
 it("editing a historical row preserves absent capture and does not infer a band",()=>{const r=finalizeAttendanceDay({statusOptionId:"option-a"},{...input,editing:true});expect(r.entry).not.toHaveProperty("eventOccurredAt");expect(r.entry.operationalDay?.mode).toBe("PRESERVE");expect(r.notice).toBeNull();});
 it("retains the existing original instant on retry",()=>{const r=finalizeAttendanceDay({statusOptionId:"option-b",eventOccurredAt:input.instant},{...input,instant:"2026-11-20T15:00:00.000Z"});expect(r.entry.eventOccurredAt).toBe(input.instant);});
 it.each([undefined,{version:1 as const,calendarKey:"old"}])("never creates with an unconfirmed calendar",contract=>{expect(()=>finalizeAttendanceDay({statusOptionId:"option-b"},{...input,contract})).toThrow("no está confirmado");});
});
