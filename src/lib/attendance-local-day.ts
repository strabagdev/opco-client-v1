import {resolveOperationalDay,operationalBoundary,shiftCivilDate,type OperationalCalendar} from "./operational-calendar";
import { formatLocalDateInput } from "../renderers/workflows/attendance/attendance-workflow-logic";

// One timer at the next local midnight; resume refreshes clocks suspended by the OS.
export function watchAttendanceLocalDay(onChange: (day: string, calendarDate?:string) => void, calendar?:OperationalCalendar,observed?:{day:string;calendarDate:string}, observeBands = false) {
  let current = calendar && observed ? observed.day : calendar ? resolveOperationalDay(new Date(),calendar).date : formatLocalDateInput(new Date());
  let currentCivil = calendar && observed ? observed.calendarDate : calendar ? resolveOperationalDay(new Date(),calendar).calendarDate : current;
  let currentBand = calendar ? resolveOperationalDay(new Date(),calendar).bandOptionId : null;
  let timer: ReturnType<typeof setTimeout>;
  let disposed = false;
  function refresh() {
    if (disposed) return;
    clearTimeout(timer);
    const now = new Date();
    const resolved = calendar ? resolveOperationalDay(now,calendar) : null;
    const day = resolved?.date ?? formatLocalDateInput(now);
    if (day !== current || resolved?.calendarDate && currentCivil!==resolved.calendarDate || observeBands && resolved && resolved.bandOptionId !== currentBand) {
      current = day;
      currentBand = resolved?.bandOptionId ?? null;
      currentCivil=resolved?.calendarDate??day;
      if(calendar)onChange(day,currentCivil);else onChange(day);
    }
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const next = resolved && calendar ? Math.min(resolved.nextBoundary,operationalBoundary(shiftCivilDate(resolved.calendarDate,1),{...calendar,dayStart:"00:00"})) : midnight.getTime();
    // Reuse this one clock for the optional band preview. Minute precision matches
    // configured HH:mm and also observes repeated/skipped civil times on DST days.
    // Home/default consumers keep the existing boundary-only scheduling.
    const wake = observeBands && calendar?.bands.length ? Math.min(next, Math.floor(now.getTime() / 60000) * 60000 + 60000) : next;
    timer = setTimeout(refresh, Math.max(1, wake - now.getTime() + 1));
  }
  refresh();
  return { refresh, dispose() { disposed = true; clearTimeout(timer); } };
}
