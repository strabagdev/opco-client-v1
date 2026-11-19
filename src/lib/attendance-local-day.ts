import {resolveOperationalDay,operationalBoundary,shiftCivilDate,type OperationalCalendar} from "./operational-calendar";
import { formatLocalDateInput } from "../renderers/workflows/attendance/attendance-workflow-logic";

// One timer at the next local midnight; resume refreshes clocks suspended by the OS.
export function watchAttendanceLocalDay(onChange: (day: string, calendarDate?:string) => void, calendar?:OperationalCalendar,observed?:{day:string;calendarDate:string}) {
  let current = calendar && observed ? observed.day : calendar ? resolveOperationalDay(new Date(),calendar).date : formatLocalDateInput(new Date());
  let currentCivil = calendar && observed ? observed.calendarDate : calendar ? resolveOperationalDay(new Date(),calendar).calendarDate : current;
  let timer: ReturnType<typeof setTimeout>;
  let disposed = false;
  function refresh() {
    if (disposed) return;
    clearTimeout(timer);
    const now = new Date();
    const resolved = calendar ? resolveOperationalDay(now,calendar) : null;
    const day = resolved?.date ?? formatLocalDateInput(now);
    if (day !== current || resolved?.calendarDate && currentCivil!==resolved.calendarDate) {
      current = day;
      currentCivil=resolved?.calendarDate??day;
      if(calendar)onChange(day,currentCivil);else onChange(day);
    }
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const next = resolved && calendar ? Math.min(resolved.nextBoundary,operationalBoundary(shiftCivilDate(resolved.calendarDate,1),{...calendar,dayStart:"00:00"})) : midnight.getTime();
    timer = setTimeout(refresh, Math.max(1, next - now.getTime() + 1));
  }
  refresh();
  return { refresh, dispose() { disposed = true; clearTimeout(timer); } };
}
