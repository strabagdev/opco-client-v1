import {describe,it,expect} from "vitest";
import {finalizeAttendanceDay} from "./attendance-operational-day";
import {operationalCalendarKey, type OperationalCalendar} from "./operational-calendar";
const calendar:OperationalCalendar={version:1,timeZone:"America/Santiago",dayStart:"08:00",bands:[{optionId:"option-a",start:"08:00",end:"20:00"},{optionId:"option-b",start:"20:00",end:"08:00"}]};
const contract={version:1 as const,calendarKey:operationalCalendarKey(calendar)};
const input={calendar,contract,date:"2026-11-18",mode:"AUTO" as const,editing:false,instant:"2026-11-19T05:00:00.123Z"};
describe("Definitive Attendance operational confirmation",()=>{
 it("leaves unconfigured consumers unchanged",()=>{const entry={statusOptionId:"option-a"};expect(finalizeAttendanceDay(entry,{...input,calendar:undefined}).entry).toBe(entry);});
 it("uses the definitive click and its configured band for a new creation",()=>{const entry={statusOptionId:"option-a"};const r=finalizeAttendanceDay(entry,input);expect(r.entry).toMatchObject({statusOptionId:"option-b",eventOccurredAt:input.instant,operationalDay:{mode:"AUTO"}});expect(r.notice).toBeNull();});
 it("a warning crossing 20:00 uses its final confirmation instant, not the opening time",()=>{
  const entry={statusOptionId:"option-a"}; // Warning opening/cancellation has no finalizer, timestamp or outbox write.
  expect(entry).not.toHaveProperty("eventOccurredAt");
  const r=finalizeAttendanceDay(entry,{...input,instant:"2026-11-18T23:00:00.000Z"});
  expect(r.entry.eventOccurredAt).toBe("2026-11-18T23:00:00.000Z");expect(r.entry.statusOptionId).toBe("option-b");expect(r.notice).toBeNull();
 });
 it("derives the new operational day from the definitive instant regardless of the consulted DATE",()=>{const r=finalizeAttendanceDay({statusOptionId:"option-b"},{...input,date:"2026-10-01",instant:"2026-11-19T11:00:00.000Z"});expect(r.date).toBe("2026-11-19");expect(r.entry.operationalDay?.mode).toBe("AUTO");});
 it("a historical or MANUAL consultation cannot assign a new creation DATE",()=>{const r=finalizeAttendanceDay({statusOptionId:"option-a"},{...input,date:"2026-10-01",mode:"MANUAL"});expect(r.date).toBe("2026-11-18");expect(r.entry.operationalDay?.mode).toBe("AUTO");expect(r.notice).toBeNull();});
 it("editing a historical row preserves absent capture and does not infer a band",()=>{const r=finalizeAttendanceDay({statusOptionId:"option-a"},{...input,editing:true});expect(r.entry).not.toHaveProperty("eventOccurredAt");expect(r.entry.operationalDay?.mode).toBe("PRESERVE");expect(r.notice).toBeNull();});
 it("retains the existing original instant on retry",()=>{const r=finalizeAttendanceDay({statusOptionId:"option-b",eventOccurredAt:input.instant},{...input,instant:"2026-11-20T15:00:00.000Z"});expect(r.entry.eventOccurredAt).toBe(input.instant);});
 it.each([undefined,{version:1 as const,calendarKey:"old"}])("never creates with an unconfirmed calendar",contract=>{expect(()=>finalizeAttendanceDay({statusOptionId:"option-b"},{...input,contract})).toThrow("no está confirmado");});
 it.each([
  ["2026-11-19T10:59:59.000Z","2026-11-18"],["2026-11-19T11:00:00.000Z","2026-11-19"],
  ["2027-01-01T05:00:00.000Z","2026-12-31"],["2026-12-01T05:00:00.000Z","2026-11-30"],
 ])("pairs capture and operational DATE at %s",(instant,date)=>{const r=finalizeAttendanceDay({statusOptionId:"option-b"},{...input,date:"1999-01-01",instant});expect(r.date).toBe(date);expect(r.entry.eventOccurredAt).toBe(instant);expect(r.entry.operationalDay?.mode).toBe("AUTO");});
 it("uses the configured zone and start rather than a contract-specific rule",()=>{const other:OperationalCalendar={version:1,timeZone:"Europe/Madrid",dayStart:"06:30",bands:[]};const r=finalizeAttendanceDay({statusOptionId:"arbitrary"},{...input,calendar:other,contract:{version:1,calendarKey:operationalCalendarKey(other)},instant:"2026-11-19T05:29:59.000Z"});expect(r.date).toBe("2026-11-18");});
});
