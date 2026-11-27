import { operationalCalendarKey, resolveOperationalDay, OperationalCalendarError, type OperationalCalendar, type OperationalDayCommand, type OperationalDayContract } from "./operational-calendar";
import type { WriteFeedbackKind } from "./write-feedback";

/** Only new captures use a configured band. Existing commands/edits keep their state. */
export function attendanceRegistrationBand(calendar: OperationalCalendar | undefined, instant: string,
  statuses?: readonly { optionId: string; label?: string }[]) {
  if (!calendar?.bands.length) return null;
  operationalCalendarKey(calendar); // Reject ambiguous/invalid definitions, never pick the first overlap.
  const resolved = resolveOperationalDay(instant, calendar);
  if (!resolved.bandOptionId) throw new OperationalCalendarError("OPERATIONAL_BAND_UNAVAILABLE", "No hay una franja configurada para este momento. No se puede registrar hasta disponer de una franja válida.");
  const status = statuses?.find(option => option.optionId === resolved.bandOptionId);
  if (statuses && !status) throw new OperationalCalendarError("OPERATIONAL_BAND_OPTION_UNAVAILABLE", "La opción de la franja vigente no está disponible. Actualiza la definición antes de registrar; el borrador se conserva.");
  return { ...resolved, optionId: resolved.bandOptionId, label: status?.label };
}

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
  statuses?: readonly { optionId: string; label?: string }[];
}): {entry:T & {eventOccurredAt?:string;operationalDay?:OperationalDayCommand};date:string;notice:string|null} {
  if (!input.calendar) return { entry, date: input.date, notice: null };
  const key = operationalCalendarKey(input.calendar);
  if (input.contract?.version !== 1 || input.contract.calendarKey !== key) throw new OperationalCalendarError("OPERATIONAL_DAY_REVIEW_REQUIRED", "El calendario preparado no está confirmado. Conecta y revisa la experiencia; el borrador se conserva.");
  const mode:OperationalDayCommand["mode"] = input.editing ? "PRESERVE" : "AUTO";
  const instant = input.editing ? entry.eventOccurredAt : entry.eventOccurredAt ?? input.instant;
  const resolved = !input.editing ? resolveOperationalDay(instant!, input.calendar) : null;
  const band = !input.editing ? attendanceRegistrationBand(input.calendar, instant!, input.statuses) : null;
  return { entry: { ...entry, ...(band ? { statusOptionId: band.optionId } : {}), ...(instant ? { eventOccurredAt: instant } : {}), operationalDay: { version: 1 as const, calendarKey: key, mode } }, date: resolved?.date ?? input.date, notice: null };
}
