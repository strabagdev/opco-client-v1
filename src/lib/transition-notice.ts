/** Presentation metadata only; never a business-date or command source. */
export type TransitionNotice = { version: 1; text: string; startsAt: string; endsAt: string };
const instant = (value: unknown): value is string => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function parseTransitionNotice(value: unknown): TransitionNotice | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Revisa el aviso de transición.");
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || Object.keys(v).some(key => !["version", "text", "startsAt", "endsAt"].includes(key)))
    throw Error("La versión o las propiedades del aviso no son compatibles.");
  if (typeof v.text !== "string" || !v.text.trim() || v.text.trim().length > 1000)
    throw Error("Escribe el aviso, con un máximo de 1000 caracteres.");
  if (!instant(v.startsAt) || !instant(v.endsAt) || v.startsAt >= v.endsAt)
    throw Error("Configura inicio y fin UTC válidos; el fin debe ser posterior al inicio.");
  return { version: 1, text: v.text.trim(), startsAt: v.startsAt, endsAt: v.endsAt };
}
/** Invalid cached metadata does not show a notice or break the experience. */
export function activeTransitionNotice(value: unknown, now = Date.now()): string | null {
  try {
    const n = parseTransitionNotice(value);
    return n && now >= Date.parse(n.startsAt) && now < Date.parse(n.endsAt) ? n.text : null;
  } catch { return null; }
}
