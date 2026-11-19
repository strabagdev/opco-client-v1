import { describe, it, expect } from "vitest";
import { assertOperationalCommand, operationalCalendarKey, parseOperationalCalendar, resolveOperationalDay, type OperationalCalendar } from "./operational-calendar";
const calendar: OperationalCalendar = { version: 1, timeZone: "America/Santiago", dayStart: "08:00", bands: [{ optionId: "option-alpha", start: "08:00", end: "20:00" }, { optionId: "option-beta", start: "20:00", end: "08:00" }] };
describe("configurable operational civil day", () => {
  it.each([
    ["2026-11-19T05:00:00.000Z", "2026-11-18", "option-beta"],
    ["2026-11-19T10:59:59.000Z", "2026-11-18", "option-beta"],
    ["2026-11-19T11:00:00.000Z", "2026-11-19", "option-alpha"],
    ["2026-11-19T22:59:59.000Z", "2026-11-19", "option-alpha"],
    ["2026-11-19T23:00:00.000Z", "2026-11-19", "option-beta"],
    ["2026-12-01T05:00:00.000Z", "2026-11-30", "option-beta"],
    ["2027-01-01T05:00:00.000Z", "2026-12-31", "option-beta"],
  ])("binds %s to %s and its actual option identity", (instant, date, option) => expect(resolveOperationalDay(instant, calendar)).toMatchObject({ date, bandOptionId: option }));
  it("does not turn a spring transition into a 24-hour date subtraction", () => {
    expect(resolveOperationalDay("2026-09-06T04:00:00.000Z", calendar)).toMatchObject({ date: "2026-09-05", calendarDate: "2026-09-06" });
    expect(resolveOperationalDay("2026-09-06T11:00:00.000Z", calendar).date).toBe("2026-09-06");
    expect(resolveOperationalDay("2026-04-05T03:00:00.000Z", calendar).date).toBe("2026-04-04");
  });
  it("uses the first occurrence of a repeated start, without flipping the day back", () => {
    const fold = { ...calendar, timeZone: "America/New_York", dayStart: "01:30" };
    expect(resolveOperationalDay("2026-11-01T05:29:59.000Z", fold).date).toBe("2026-10-31");
    expect(resolveOperationalDay("2026-11-01T05:30:00.000Z", fold).date).toBe("2026-11-01");
    expect(resolveOperationalDay("2026-11-01T06:15:00.000Z", fold).date).toBe("2026-11-01");
  });
  it("uses the first real instant following a missing start", () => {
    const gap = { ...calendar, timeZone: "America/New_York", dayStart: "02:30" };
    expect(resolveOperationalDay("2026-03-08T06:59:59.000Z", gap).date).toBe("2026-03-07");
    expect(resolveOperationalDay("2026-03-08T07:00:00.000Z", gap).date).toBe("2026-03-08");
  });
  it.each([
    { ...calendar, dayStart: "24:00" }, { ...calendar, timeZone: "Mars/Invalid" }, { ...calendar, version: 2 },
    { ...calendar, bands: [{ optionId: "a", start: "20:00", end: "20:00" }] },
    { ...calendar, bands: [...calendar.bands, { optionId: "c", start: "07:00", end: "09:00" }] },
    { ...calendar, bands: [{ optionId: "a", start: "22:00", end: "02:00" }, { optionId: "b", start: "01:00", end: "03:00" }] },
  ])("rejects ambiguous or invalid definitions %#", value => expect(() => parseOperationalCalendar(value)).toThrow());
  it("allows an explicit gap without guessing an option", () => expect(resolveOperationalDay("2026-11-19T05:00:00.000Z", { ...calendar, bands: [calendar.bands[0]] }).bandOptionId).toBeNull());
  it("keeps DATE/instant fixed across next-day retries and a manual retrospective date", () => {
    const eventOccurredAt = "2026-11-19T05:00:00.000Z", operationalDay = { version: 1 as const, calendarKey: operationalCalendarKey(calendar), mode: "AUTO" as const };
    const command = JSON.parse(JSON.stringify({ eventOccurredAt, operationalDay, date: "2026-11-18" }));
    expect(() => assertOperationalCommand(calendar, command)).not.toThrow();
    expect(command.eventOccurredAt).toBe(eventOccurredAt);
    expect(() => assertOperationalCommand(calendar, { ...command, date: "2026-11-19" })).toThrow();
    expect(() => assertOperationalCommand(calendar, { ...command, date: "2026-10-01", operationalDay: { ...operationalDay, mode: "MANUAL" } })).not.toThrow();
    expect(() => assertOperationalCommand(calendar, { date: "2026-10-01", expectedUpdatedAt: "base", operationalDay: { ...operationalDay, mode: "PRESERVE" } })).not.toThrow();
  });
  it("preserves default behavior and rejects old or changed commands rather than reinterpreting them", () => {
    expect(() => assertOperationalCommand(undefined, { date: "2026-11-19" })).not.toThrow();
    expect(() => assertOperationalCommand(calendar, { date: "2026-11-19" })).toThrow(/conservan/);
    expect(() => assertOperationalCommand(calendar, { date: "2026-11-19", operationalDay: { version: 1, calendarKey: "old", mode: "AUTO" } })).toThrow();
    expect(operationalCalendarKey(calendar)).toBe(operationalCalendarKey({ ...calendar, bands: [...calendar.bands].reverse() }));
  });
});
