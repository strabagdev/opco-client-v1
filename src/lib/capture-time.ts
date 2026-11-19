export type CaptureTimeConfig = { fieldId: string; timeZone: string };
export type CaptureTimeCommand = CaptureTimeConfig & { version: 1 };
export type CaptureTimeRead = CaptureTimeCommand & { value: string | null; source: "DEVICE_CONFIRMATION" | null };
export const validCaptureInstant = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export class CaptureTimeReviewError extends Error {
  constructor(public code = "CAPTURE_TIME_REVIEW_REQUIRED") { super("Esta captura requiere un comando y una definición compatibles. La intención anterior se conserva sin asignarle una hora nueva."); }
}
export function captureTimeCommand(config: CaptureTimeConfig | undefined, confirmed?: CaptureTimeCommand): CaptureTimeCommand | undefined {
  if (!config) return undefined;
  if (!confirmed || confirmed.version !== 1 || confirmed.fieldId !== config.fieldId || confirmed.timeZone !== config.timeZone) throw new CaptureTimeReviewError();
  try { new Intl.DateTimeFormat("en", {timeZone:config.timeZone}); } catch { throw new CaptureTimeReviewError(); }
  return { version: 1, fieldId: config.fieldId, timeZone: config.timeZone };
}
export function captureTimeMetadata(v: { captureTime?: CaptureTimeCommand | CaptureTimeRead }) {
  return v.captureTime ? { captureTime: { ...v.captureTime } } : {};
}
export function asCaptureCommand(v: CaptureTimeCommand): CaptureTimeCommand {
  return {version:v.version,fieldId:v.fieldId,timeZone:v.timeZone};
}
/** Same instant everywhere; DATE is compared as text and is never converted through Date. */
export function presentCaptureTime(value: unknown, timeZone: string, operationalDate?: string) {
  if (!validCaptureInstant(value)) return { compact: "Hora de captura no disponible", detail: "Hora de captura no disponible" };
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23",timeZoneName:"longOffset"}).formatToParts(new Date(value));
    const p = Object.fromEntries(parts.map(x=>[x.type,x.value])), day = `${p.year}-${p.month}-${p.day}`, date = `${p.day}-${p.month}-${p.year}`;
    return { compact: `${p.hour}:${p.minute}${operationalDate && operationalDate !== day ? ` · ${date}` : ""}`,
      detail: `${date} ${p.hour}:${p.minute}:${p.second} · ${timeZone} · ${(p.timeZoneName==="GMT"?"UTC+00:00":p.timeZoneName.replace("GMT","UTC"))} · Captura del reloj del dispositivo · ${value}` };
  } catch { return {compact:"Hora de captura no disponible",detail:"Zona de captura no disponible; no se reinterpretó el instante."}; }
}
export function captureRead(v: CaptureTimeCommand, value?: string): CaptureTimeRead {
  return {...asCaptureCommand(v),value:validCaptureInstant(value)?value:null,source:validCaptureInstant(value)?"DEVICE_CONFIRMATION":null};
}

export function assertCaptureAck(result: {result:string;captureTime?:CaptureTimeRead}, input:{captureTime?:CaptureTimeCommand;eventOccurredAt?:string}) {
  if(!input.captureTime)return;
  const r=result.captureTime;
  if(!r || r.version!==1 || r.fieldId!==input.captureTime.fieldId || r.timeZone!==input.captureTime.timeZone || (r.value===null ? r.source!==null || result.result==="CREATED" : !validCaptureInstant(r.value) || r.source!=="DEVICE_CONFIRMATION") || ((result.result==="CREATED" || result.result==="UPDATED" && input.eventOccurredAt!==undefined) && r.value!==input.eventOccurredAt))throw new CaptureTimeReviewError("CAPTURE_TIME_ACK_INCOMPATIBLE");
}
