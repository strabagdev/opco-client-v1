import { stateUpdateScheduleIntentFingerprint, type StateUpdateScheduleMetadata } from "./state-update-schedule";
import type { CompositeStateIdentity, StateUpdateField } from "./opco-api";

export function compositeIdentityKey(identity?: CompositeStateIdentity | null): string | null {
  if (!identity) return null;
  if (identity.version !== 1 || !identity.definitionId || !identity.values || Array.isArray(identity.values)) throw new Error("INVALID_COMPOSITE_IDENTITY");
  const entries = Object.entries(identity.values).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (!entries.length || entries.some(([id, option]) => !id || typeof option !== "string" || !option || option.trim() !== option)) throw new Error("INCOMPLETE_COMPOSITE_IDENTITY");
  return JSON.stringify([1, identity.definitionId, entries]);
}
export function selectCompositeIdentity(definition: { version: 1; definitionId: string } | undefined, fields: StateUpdateField[] | undefined, values: Record<string, string>): CompositeStateIdentity | undefined {
  if (!definition || !fields?.length || Object.keys(values).length !== fields.length || fields.some(f => !f.options.some(o => o.optionId === values[f.fieldId]))) return undefined;
  return { ...definition, values: Object.fromEntries(fields.map(f => [f.fieldId, values[f.fieldId]])) };
}

export function parseCompositeContextValues(raw?: string | string[]): Record<string,string> {
  if (typeof raw !== "string") return {};
  try { const value = JSON.parse(raw); if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some(v=>typeof v!=="string" || !v || v.trim()!==v)) return {}; return value; } catch { return {}; }
}

/** Binds a UI confirmation to the exact shown scope, version and intended content. */
export function compositeConfirmationKey(scope: string, subject: string, base: string, states: {fieldId:string;value?:unknown;optionId?:string|null;label?:string|null}[], extras: unknown, schedule?: StateUpdateScheduleMetadata) {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,stable(v)])) : value;
  const scheduleKey = stateUpdateScheduleIntentFingerprint(schedule);
  return JSON.stringify(stable([scope,subject,base,[...states].sort((a,b)=>a.fieldId<b.fieldId?-1:a.fieldId>b.fieldId?1:0),extras, ...(scheduleKey !== undefined ? [scheduleKey] : [])]));
}

export function hasVerifiedCompositeAbsence(authority?: {status: string; remoteRecordId?: string | null}) {
  return authority?.status === "verified" && authority.remoteRecordId === null;
}
