import{describe,it,expect}from"vitest";
import{attendancePreparationPeriod,currentMonthDateKeys}from"./attendance-snapshot-cache";
import{matchesPreparationRequest}from"./preparation-revision-contract";
import type{OperationalCalendar}from"./operational-calendar";
const calendar:OperationalCalendar={version:1,timeZone:"America/Santiago",dayStart:"08:00",bands:[]};
describe("operational month used by downloads and reuse admission",()=>{
 it.each([["2026-11-01T05:00:00Z","2026-10-31","2026-10-01",31],["2026-11-01T11:00:00Z","2026-11-01","2026-11-01",30],["2027-01-01T05:00:00Z","2026-12-31","2026-12-01",31],["2028-03-01T05:00:00Z","2028-02-29","2028-02-01",29]])("uses the operational month at %s",(at,date,first,total)=>{const p=attendancePreparationPeriod(new Date(at),calendar);expect(p.date).toBe(date);expect(p.dates[0]).toBe(first);expect(p.dates).toHaveLength(total);expect(p.dates.at(-1)).toBe(`${first.slice(0,7)}-${total}`);});
 it("keeps unconfigured preparation unchanged",()=>{const now=new Date("2026-11-01T05:00:00Z");expect(attendancePreparationPeriod(now).dates).toEqual(currentMonthDateKeys(now));});
 it("a complete receipt for the calendar month cannot credit the different operational month",()=>{
  const view={id:"v",config:{operationalCalendar:calendar}},prepared={appView:view};
  const receipt={appViewId:"v",markers:[],snapshotId:"snapshot",coverage:{kind:"attendance-month",dates:attendancePreparationPeriod(new Date("2026-11-01T11:00:00Z"),calendar).dates}};
  const requested={appViewId:"v",kind:"attendance-month",dates:attendancePreparationPeriod(new Date("2026-11-01T05:00:00Z"),calendar).dates,definition:view};
  expect(matchesPreparationRequest(receipt as never,{...requested,dates:receipt.coverage.dates}as never,prepared as never)).toBe(true);
  expect(matchesPreparationRequest(receipt as never,requested as never,prepared as never)).toBe(false);
 });
});
