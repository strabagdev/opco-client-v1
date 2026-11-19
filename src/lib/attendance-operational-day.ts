import { operationalCalendarKey, resolveOperationalDay, OperationalCalendarError, type OperationalCalendar, type OperationalDayCommand, type OperationalDayContract } from "./operational-calendar";

export function finalizeAttendanceDay<T extends { eventOccurredAt?: string; operationalDay?: OperationalDayCommand; statusOptionId: string }>(entry: T, input: {
  calendar?: OperationalCalendar; contract?: OperationalDayContract; date: string;
  mode: "AUTO" | "MANUAL"; editing: boolean; instant: string;
}): {entry:T & {eventOccurredAt?:string;operationalDay?:OperationalDayCommand};notice:string|null} {
  if (!input.calendar) return { entry, notice: null };
  const key = operationalCalendarKey(input.calendar);
  if (input.contract?.version !== 1 || input.contract.calendarKey !== key) throw new OperationalCalendarError("OPERATIONAL_DAY_REVIEW_REQUIRED", "El calendario preparado no está confirmado. Conecta y revisa la experiencia; el borrador se conserva.");
  const mode:OperationalDayCommand["mode"] = input.editing ? "PRESERVE" : input.mode;
  const instant = input.editing ? entry.eventOccurredAt : entry.eventOccurredAt ?? input.instant;
  const resolved = !input.editing && mode === "AUTO" ? resolveOperationalDay(instant!, input.calendar) : null;
  if (resolved && resolved.date !== input.date) throw new OperationalCalendarError("OPERATIONAL_DAY_ROLLED", "Cambió el día operativo. Vuelve al día operativo actual y confirma de nuevo; no se creó una intención.");
  const notice = input.editing ? null : mode === "MANUAL"
    ? "Se conservó la fecha manual. La franja histórica no se dedujo de la hora actual."
    : resolved?.bandOptionId && resolved.bandOptionId !== entry.statusOptionId
      ? "La opción elegida no coincide con la franja configurada para la confirmación. Se conservó tu selección manual."
      : null;
  return { entry: { ...entry, ...(instant ? { eventOccurredAt: instant } : {}), operationalDay: { version: 1 as const, calendarKey: key, mode } }, notice };
}
