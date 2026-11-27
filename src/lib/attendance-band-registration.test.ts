import {describe,expect,it} from "vitest";
import * as runtime from "./attendance-operational-day";
import {operationalCalendarKey,type OperationalCalendar} from "./operational-calendar";
const calendar:OperationalCalendar={version:1,timeZone:"America/Santiago",dayStart:"08:00",bands:[{optionId:"slot-day",start:"08:00",end:"20:00"},{optionId:"slot-night",start:"20:00",end:"08:00"}]};
const statuses=[{optionId:"slot-day",label:"Configured day"},{optionId:"slot-night",label:"Configured night"}];
const config=(instant:string,c=calendar)=>({calendar:c,contract:{version:1 as const,calendarKey:operationalCalendarKey(c)},date:"1999-01-01",mode:"AUTO" as const,editing:false,instant,statuses});
describe("configured automatic Attendance band for new captures",()=>{
 it("derives the configured state and operational DATE from the same final capture instead of a manual default",()=>{
  const r=runtime.finalizeAttendanceDay({statusOptionId:"slot-day"},config("2026-11-19T05:10:11.092Z"));expect(r.entry.statusOptionId).toBe("slot-night");expect(r.date).toBe("2026-11-18");expect(r.entry.eventOccurredAt).toBe("2026-11-19T05:10:11.092Z");expect(r.notice).toBeNull();
 });
 it.each([
  ["2026-11-19T10:59:59.000Z","2026-11-18","slot-night"],["2026-11-19T11:00:00.000Z","2026-11-19","slot-day"],
  ["2026-11-19T22:59:59.000Z","2026-11-19","slot-day"],["2026-11-19T23:00:00.000Z","2026-11-19","slot-night"],
  ["2027-01-01T05:00:00.000Z","2026-12-31","slot-night"],["2026-12-01T05:00:00.000Z","2026-11-30","slot-night"],
 ])("uses exact configured limits at %s",(instant,date,band)=>{const r=runtime.finalizeAttendanceDay({statusOptionId:"unrelated"},config(instant));expect(r.date).toBe(date);expect(r.entry.statusOptionId).toBe(band);expect(r.entry.eventOccurredAt).toBe(instant);});
 it("uses a different zone/start and identity rather than fixed labels or contract rules",()=>{const c:OperationalCalendar={version:1,timeZone:"Asia/Kolkata",dayStart:"06:30",bands:[{optionId:"slot-night",start:"06:30",end:"18:15"},{optionId:"slot-day",start:"18:15",end:"06:30"}]};const r=runtime.finalizeAttendanceDay({statusOptionId:"slot-day"},config("2026-11-19T01:00:00.000Z",c));expect(r.date).toBe("2026-11-19");expect(r.entry.statusOptionId).toBe("slot-night");});
 it("never fills a gap with the configured default",()=>{const c={...calendar,bands:calendar.bands.slice(0,1)};expect(()=>runtime.finalizeAttendanceDay({statusOptionId:"slot-day"},config("2026-11-19T05:00:00.000Z",c))).toThrow("No hay una franja");});
 it("rejects overlaps rather than accepting the first matching band",()=>{const c={...calendar,bands:[...calendar.bands,{optionId:"third",start:"19:00",end:"21:00"}]};expect(()=>runtime.attendanceRegistrationBand(c,"2026-11-19T23:00:00.000Z",statuses)).toThrow("solapan");});
 it("requires the actual configured SELECT option to remain available",()=>{expect(()=>runtime.attendanceRegistrationBand(calendar,"2026-11-19T05:00:00.000Z",statuses.slice(0,1))).toThrow("no está disponible");});
 it("keeps manual existing-record edits and missing historical captures unchanged",()=>{const entry={statusOptionId:"slot-day"};const r=runtime.finalizeAttendanceDay(entry,{...config("2026-11-19T05:00:00.000Z"),editing:true,date:"2026-10-01"});expect(r.entry.statusOptionId).toBe("slot-day");expect(r.date).toBe("2026-10-01");expect(r.entry).not.toHaveProperty("eventOccurredAt");expect(r.entry.operationalDay?.mode).toBe("PRESERVE");});
 it("keeps unconfigured and calendar-without-bands state behavior",()=>{const entry={statusOptionId:"manual"};expect(runtime.finalizeAttendanceDay(entry,{...config("2026-11-19T05:00:00.000Z"),calendar:undefined}).entry).toBe(entry);expect(runtime.finalizeAttendanceDay(entry,config("2026-11-19T05:00:00.000Z",{...calendar,bands:[]})).entry.statusOptionId).toBe("manual");});
 it("uses real instants across a repeated civil hour without changing the original capture",()=>{const c:OperationalCalendar={version:1,timeZone:"America/New_York",dayStart:"04:00",bands:[{optionId:"slot-day",start:"01:30",end:"04:00"},{optionId:"slot-night",start:"04:00",end:"01:30"}]};for(const instant of ["2026-11-01T05:45:00.123Z","2026-11-01T06:45:00.123Z"]){const r=runtime.finalizeAttendanceDay({statusOptionId:"ignored"},config(instant,c));expect(r.entry.statusOptionId).toBe("slot-day");expect(r.entry.eventOccurredAt).toBe(instant);expect(r.date).toBe("2026-10-31");}});
});
