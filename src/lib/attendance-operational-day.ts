import { operationalCalendarKey, resolveOperationalDay, OperationalCalendarError, type OperationalCalendar, type OperationalDayCommand, type OperationalDayContract } from "./operational-calendar";
import type { WriteFeedbackKind } from "./write-feedback";

/** A band warning describes one confirmation; persistence is reported separately. */
export function savedAttendanceBandNotice(notice: string, kind: WriteFeedbackKind) {
  const result = kind === "server-confirmed" ? "Guardado confirmado por Opco." : "Guardado en este dispositivo.";
  return `${result} Aviso de esa confirmación: ${notice}`;
}

/** New commands derive DATE from their original definitive instant, never the consultation.
 * Existing persisted commands are replayed by the outbox unchanged; edits preserve DATE. */
export function finalizeAttendanceDay<T extends { eventOccurredAt?: string; operationalDay?: OperationalDayCommand; statusOptionId: string }>(entry: T, input: {
  calendar?: OperationalCalendar; contract?: OperationalDayContract; date: string;
  mode: "AUTO" | "MANUAL"; editing: boolean; instant: string;
}): {entry:T & {eventOccurredAt?:string;operationalDay?:OperationalDayCommand};date:string;notice:string|null} {
  if (!input.calendar) return { entry, date: input.date, notice: null };
  const key = operationalCalendarKey(input.calendar);
  if (input.contract?.version !== 1 || input.contract.calendarKey !== key) throw new OperationalCalendarError("OPERATIONAL_DAY_REVIEW_REQUIRED", "El calendario preparado no está confirmado. Conecta y revisa la experiencia; el borrador se conserva.");
  const mode:OperationalDayCommand["mode"] = input.editing ? "PRESERVE" : "AUTO";
  const instant = input.editing ? entry.eventOccurredAt : entry.eventOccurredAt ?? input.instant;
  const resolved = !input.editing ? resolveOperationalDay(instant!, input.calendar) : null;
  const notice = resolved?.bandOptionId && resolved.bandOptionId !== entry.statusOptionId
      ? "La opción elegida no coincide con la franja configurada para la confirmación. Se conservó tu selección manual."
      : null;
  return { entry: { ...entry, ...(instant ? { eventOccurredAt: instant } : {}), operationalDay: { version: 1 as const, calendarKey: key, mode } }, date: resolved?.date ?? input.date, notice };
}
