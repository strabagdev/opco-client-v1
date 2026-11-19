/** Versioned civil-time policy. DATE remains a date, never a server timestamp. */
export type OperationalCalendar = {
  version: 1;
  timeZone: string;
  dayStart: string;
  bands: { optionId: string; start: string; end: string }[];
};
export type OperationalDayContract = { version: 1; calendarKey: string };
export type OperationalDayCommand = {
  version: 1;
  calendarKey: string;
  mode: "AUTO" | "MANUAL" | "PRESERVE";
};
export class OperationalCalendarError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const fail = (message: string): never => { throw new OperationalCalendarError("OPERATIONAL_CALENDAR_INVALID", message); };
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const minute = (x: unknown) => typeof x === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(x) ? Number(x.slice(0, 2)) * 60 + Number(x.slice(3)) : -1;
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string) {
  let value = formatters.get(zone);
  if (!value) { value = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); formatters.set(zone, value); }
  return value;
}
export function parseOperationalCalendar(value: unknown): OperationalCalendar | undefined {
  if (value === undefined) return undefined;
  if (!object(value) || value.version !== 1 || Object.keys(value).some(k => !["version", "timeZone", "dayStart", "bands"].includes(k)) || typeof value.timeZone !== "string" || !/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(value.timeZone) || minute(value.dayStart) < 0 || !Array.isArray(value.bands) || value.bands.length > 48) return fail("Configura zona IANA, inicio HH:mm y franjas válidas.");
  try { formatter(value.timeZone); } catch { return fail("La zona IANA no está disponible."); }
  const bands = value.bands.map(band => {
    if (!object(band) || Object.keys(band).some(k => !["optionId", "start", "end"].includes(k)) || typeof band.optionId !== "string" || !band.optionId.trim() || band.optionId !== band.optionId.trim() || minute(band.start) < 0 || minute(band.end) < 0 || band.start === band.end) return fail("Cada franja requiere una opción real y límites distintos HH:mm.");
    return { optionId: band.optionId, start: band.start as string, end: band.end as string };
  });
  const occupied = new Set<number>();
  for (const band of bands) {
    for (let m = minute(band.start); m !== minute(band.end); m = (m + 1) % 1440) {
      if (occupied.has(m)) return fail("Las franjas se solapan. Los intervalos incluyen el inicio y excluyen el final.");
      occupied.add(m);
    }
  }
  return { version: 1, timeZone: value.timeZone, dayStart: value.dayStart as string, bands };
}
export function operationalCalendarKey(calendar: OperationalCalendar) {
  const valid = parseOperationalCalendar(calendar)!;
  return JSON.stringify({ ...valid, bands: [...valid.bands].sort((a, b) => a.start.localeCompare(b.start) || a.optionId.localeCompare(b.optionId)) });
}
function civil(instant: number, zone: string) {
  const p = Object.fromEntries(formatter(zone).formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}`, wall: Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) };
}
export function shiftCivilDate(date: string, amount: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + amount)).toISOString().slice(0, 10);
}
const boundaryCache = new Map<string, number>();
/** Fold: first occurrence. Gap: first real instant after the missing civil boundary. */
export function operationalBoundary(date: string, calendar: OperationalCalendar): number {
  const key = `${calendar.timeZone}|${calendar.dayStart}|${date}`, cached = boundaryCache.get(key);
  if (cached !== undefined) return cached;
  const wall = Date.parse(`${date}T${calendar.dayStart}:00.000Z`);
  if (!Number.isFinite(wall)) return fail("Día operativo inválido.");
  const offsets = new Set([-36, -24, -12, 0, 12, 24, 36].map(hour => {
    const t = wall + hour * 3600000;
    return civil(t, calendar.timeZone).wall - t;
  }));
  const candidates = [...offsets].map(offset => wall - offset);
  const matches = candidates.filter(t => civil(t, calendar.timeZone).wall === wall);
  let result: number;
  if (matches.length) result = Math.min(...matches);
  else {
    let low = Math.min(...candidates), high = Math.max(...candidates);
    if (civil(low, calendar.timeZone).wall >= wall || civil(high, calendar.timeZone).wall < wall) return fail("No se pudo resolver el cambio horario de esta jornada.");
    while (high - low > 1000) {
      const middle = Math.floor((low + high) / 2000) * 1000;
      if (civil(middle, calendar.timeZone).wall >= wall) high = middle; else low = middle;
    }
    result = high;
  }
  if (boundaryCache.size > 256) boundaryCache.clear();
  boundaryCache.set(key, result);
  return result;
}
export function resolveOperationalDay(instant: string | Date, calendar: OperationalCalendar) {
  const time = new Date(instant).getTime();
  if (!Number.isFinite(time)) return fail("El instante de confirmación no es válido.");
  const local = civil(time, calendar.timeZone);
  let date = local.date;
  for (let attempt = 0; attempt < 4 && time < operationalBoundary(date, calendar); attempt++) date = shiftCivilDate(date, -1);
  const currentMinute = minute(local.time.slice(0, 5));
  const band = calendar.bands.find(b => minute(b.start) < minute(b.end)
    ? currentMinute >= minute(b.start) && currentMinute < minute(b.end)
    : currentMinute >= minute(b.start) || currentMinute < minute(b.end));
  let nextDate = shiftCivilDate(date, 1), nextBoundary = operationalBoundary(nextDate, calendar);
  for (let n = 0; n < 4 && nextBoundary <= time; n++) { nextDate = shiftCivilDate(nextDate, 1); nextBoundary = operationalBoundary(nextDate, calendar); }
  return { date, bandOptionId: band?.optionId ?? null, localTime: local.time, calendarDate: local.date, nextBoundary };
}
export function assertOperationalCommand(calendar: OperationalCalendar | undefined, input: { operationalDay?: OperationalDayCommand; eventOccurredAt?: string; dateValue?: string; date?: string; expectedUpdatedAt?: unknown; targetRecordId?: unknown; overwrite?: boolean }) {
  const command = input.operationalDay;
  if (!calendar) {
    if (command) throw new OperationalCalendarError("OPERATIONAL_CALENDAR_CHANGED", "Cambió el calendario. Conserva la intención para revisión.");
    return;
  }
  if (!command || command.version !== 1 || command.calendarKey !== operationalCalendarKey(calendar) || !["AUTO", "MANUAL", "PRESERVE"].includes(command.mode) || Object.keys(command).some(k => !["version", "calendarKey", "mode"].includes(k))) throw new OperationalCalendarError("OPERATIONAL_DAY_REVIEW_REQUIRED", "Este registro requiere revisar el calendario compatible. La fecha y el pendiente originales se conservan.");
  if (command.mode === "PRESERVE") {
    if (!input.expectedUpdatedAt && !input.targetRecordId && !input.overwrite) throw new OperationalCalendarError("OPERATIONAL_DAY_BASE_REQUIRED", "Editar requiere la identidad y base del registro seleccionado.");
    return;
  }
  if (!input.eventOccurredAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.eventOccurredAt) || !Number.isFinite(Date.parse(input.eventOccurredAt)) || new Date(input.eventOccurredAt).toISOString() !== input.eventOccurredAt) throw new OperationalCalendarError("OPERATIONAL_DAY_INSTANT_REQUIRED", "Falta el instante original de confirmación; no se asignó la hora del servidor.");
  if (command.mode === "AUTO" && (input.dateValue ?? input.date) !== resolveOperationalDay(input.eventOccurredAt, calendar).date) throw new OperationalCalendarError("OPERATIONAL_DAY_MISMATCH", "El día automático no coincide con su confirmación original. Conserva la intención y revisa la fecha.");
}
