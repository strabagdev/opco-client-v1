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
