import { afterEach, expect, it, vi } from "vitest";
import { watchAttendanceLocalDay } from "./attendance-local-day";

afterEach(() => vi.useRealTimers());

it("updates at local midnight without notifying or polling during the same day", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 13, 23, 59, 59));
  const changed = vi.fn();
  const clock = watchAttendanceLocalDay(changed);
  clock.refresh();
  expect(changed).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1001);
  expect(changed).toHaveBeenCalledExactlyOnceWith("2026-10-14");
  expect(vi.getTimerCount()).toBe(1);
  clock.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it("refreshes after suspended time, handles backwards calendar changes and ignores late callbacks", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 13, 12));
  const changed = vi.fn();
  const clock = watchAttendanceLocalDay(changed);
  vi.setSystemTime(new Date(2026, 9, 15, 8));
  clock.refresh();
  expect(changed).toHaveBeenLastCalledWith("2026-10-15");
  vi.setSystemTime(new Date(2026, 9, 14, 8));
  clock.refresh();
  expect(changed).toHaveBeenLastCalledWith("2026-10-14");
  clock.dispose();
  vi.setSystemTime(new Date(2026, 9, 16));
  clock.refresh();
  expect(changed).toHaveBeenCalledTimes(2);
});

it("observes the configured operational boundary rather than midnight",()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-19T10:59:59.000Z"));const changed=vi.fn();
 const clock=watchAttendanceLocalDay(changed,{version:1,timeZone:"America/Santiago",dayStart:"08:00",bands:[]});
 vi.advanceTimersByTime(1001);expect(changed).toHaveBeenCalledExactlyOnceWith("2026-11-19","2026-11-19");expect(vi.getTimerCount()).toBe(1);clock.dispose();
});
it("keeps the operational DATE across civil midnight and refreshes it after suspension",()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-19T02:59:59.000Z"));const changed=vi.fn();
 const clock=watchAttendanceLocalDay(changed,{version:1,timeZone:"America/Santiago",dayStart:"08:00",bands:[]});
 vi.advanceTimersByTime(1001);expect(changed).toHaveBeenLastCalledWith("2026-11-18","2026-11-19");
 vi.setSystemTime(new Date("2026-12-01T11:00:00.000Z"));clock.refresh();expect(changed).toHaveBeenLastCalledWith("2026-12-01","2026-12-01");clock.dispose();
});

it("refreshes a stale visible day when resubscribing after suspension",()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-19T11:00:01.000Z"));const changed=vi.fn();
 const clock=watchAttendanceLocalDay(changed,{version:1,timeZone:"America/Santiago",dayStart:"08:00",bands:[]},{day:"2026-11-18",calendarDate:"2026-11-19"});
 expect(changed).toHaveBeenCalledExactlyOnceWith("2026-11-19","2026-11-19");clock.refresh();expect(changed).toHaveBeenCalledTimes(1);clock.dispose();
});


it("reuses one optional band clock and does not notify on unchanged minutes",()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-19T22:58:00.000Z"));const changed=vi.fn();
 const calendar={version:1 as const,timeZone:"America/Santiago",dayStart:"08:00",bands:[{optionId:"day",start:"08:00",end:"20:00"},{optionId:"night",start:"20:00",end:"08:00"}]};
 const clock=watchAttendanceLocalDay(changed,calendar,undefined,true);vi.advanceTimersByTime(60001);expect(changed).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(1);vi.advanceTimersByTime(60000);expect(changed).toHaveBeenCalledExactlyOnceWith("2026-11-19","2026-11-19");expect(vi.getTimerCount()).toBe(1);clock.dispose();expect(vi.getTimerCount()).toBe(0);
});
it("does not add band polling or notifications to the default Home consumer",()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-19T22:59:00.000Z"));const changed=vi.fn();const clock=watchAttendanceLocalDay(changed,{version:1,timeZone:"America/Santiago",dayStart:"08:00",bands:[{optionId:"day",start:"08:00",end:"20:00"},{optionId:"night",start:"20:00",end:"08:00"}]});vi.advanceTimersByTime(120001);expect(changed).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(1);clock.dispose();
});
it("observes the actual band after a repeated hour and after suspension",()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-01T05:59:59.000Z"));const changed=vi.fn(),calendar={version:1 as const,timeZone:"America/New_York",dayStart:"04:00",bands:[{optionId:"day",start:"01:30",end:"04:00"},{optionId:"night",start:"04:00",end:"01:30"}]};const clock=watchAttendanceLocalDay(changed,calendar,undefined,true);vi.advanceTimersByTime(1001);expect(changed).toHaveBeenCalledExactlyOnceWith("2026-10-31","2026-11-01");vi.setSystemTime(new Date("2026-11-01T06:45:00.000Z"));clock.refresh();expect(changed).toHaveBeenCalledTimes(2);clock.dispose();
});
