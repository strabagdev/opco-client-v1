import { formatLocalDateInput } from "../renderers/workflows/attendance/attendance-workflow-logic";

// One timer at the next local midnight; resume refreshes clocks suspended by the OS.
export function watchAttendanceLocalDay(onChange: (day: string) => void) {
  let current = formatLocalDateInput(new Date());
  let timer: ReturnType<typeof setTimeout>;
  let disposed = false;
  function refresh() {
    if (disposed) return;
    clearTimeout(timer);
    const now = new Date();
    const day = formatLocalDateInput(now);
    if (day !== current) {
      current = day;
      onChange(day);
    }
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    timer = setTimeout(refresh, Math.max(1, midnight.getTime() - now.getTime() + 1));
  }
  refresh();
  return { refresh, dispose() { disposed = true; clearTimeout(timer); } };
}
