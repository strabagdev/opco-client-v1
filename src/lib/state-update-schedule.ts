/** Durable optional schedule envelope shared by capture, cache and synchronization. */
export type StateUpdateScheduleReference = {
  schemaVersion: 1;
  bindingId: string;
  revisionId: string;
  revisionDigest: string;
} | { kind: "legacy" };

export type StateUpdateScheduleApplication = Exclude<StateUpdateScheduleReference, { kind: "legacy" }> & {
  scheduleRecordId: string;
  operationalDate: string;
  applied: {
    name: string;
    startTime: string;
    endTime: string;
    endDayOffset: number;
    timeZone: string;
    nominalMinutes: number;
    durationPolicy: "civil-clock";
  };
} | { kind: "legacy" };

export type StateUpdateScheduleMetadata = {
  schedule?: StateUpdateScheduleReference;
  scheduleApplication?: StateUpdateScheduleApplication;
};

export class StateUpdateScheduleReviewError extends Error {
  readonly code = "SCHEDULE_METADATA_REVIEW_REQUIRED";
  constructor() {
    super("El horario guardado requiere revisión explícita. El cambio local se conserva.");
    this.name = "StateUpdateScheduleReviewError";
  }
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && !!value && value.trim() === value;

function reference(value: unknown): value is StateUpdateScheduleReference {
  return object(value) && ("kind" in value ? value.kind === "legacy" && Object.keys(value).length === 1 :
    value.schemaVersion === 1 && id(value.bindingId) && id(value.revisionId) && id(value.revisionDigest));
}

function application(value: unknown): value is StateUpdateScheduleApplication {
  if (!reference(value)) return false;
  if ("kind" in value) return true;
  const raw = value as unknown as Record<string, unknown>, applied = raw.applied;
  return id(raw.scheduleRecordId) && typeof raw.operationalDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.operationalDate) &&
    object(applied) && id(applied.name) && id(applied.timeZone) &&
    typeof applied.startTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(applied.startTime) &&
    typeof applied.endTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(applied.endTime) &&
    Number.isInteger(applied.endDayOffset) && Number(applied.endDayOffset) >= 0 &&
    typeof applied.nominalMinutes === "number" && Number.isFinite(applied.nominalMinutes) && applied.nominalMinutes > 0 &&
    applied.durationPolicy === "civil-clock";
}

export function scheduleReferenceFromApplication(value: StateUpdateScheduleApplication): StateUpdateScheduleReference {
  return "kind" in value ? { kind: "legacy" } : {
    schemaVersion: value.schemaVersion, bindingId: value.bindingId,
    revisionId: value.revisionId, revisionDigest: value.revisionDigest,
  };
}

/** Validate without coercing, defaulting or stripping the stored snapshot. Absent stays absent. */
export function stateUpdateScheduleMetadata(value: unknown): StateUpdateScheduleMetadata {
  if (!object(value)) return {};
  const result: StateUpdateScheduleMetadata = {};
  if (value.schedule !== undefined) {
    if (!reference(value.schedule)) throw new StateUpdateScheduleReviewError();
    result.schedule = value.schedule;
  }
  if (value.scheduleApplication !== undefined) {
    if (!application(value.scheduleApplication)) throw new StateUpdateScheduleReviewError();
    result.scheduleApplication = value.scheduleApplication;
  }
  if (result.schedule && result.scheduleApplication &&
      canonicalScheduleMetadata(result.schedule) !== canonicalScheduleMetadata(scheduleReferenceFromApplication(result.scheduleApplication))) {
    throw new StateUpdateScheduleReviewError();
  }
  return result;
}

export function canonicalScheduleMetadata(value: unknown): string {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable) : object(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, stable(v)])) : item;
  return JSON.stringify(stable(value));
}

/** Wire carries the exact reference; the applied snapshot remains durable and is not trusted by Core. */
export function stateUpdateScheduleRequest(value: unknown): Pick<StateUpdateScheduleMetadata, "schedule"> {
  const metadata = stateUpdateScheduleMetadata(value);
  return metadata.schedule ? { schedule: metadata.schedule } : metadata.scheduleApplication
    ? { schedule: scheduleReferenceFromApplication(metadata.scheduleApplication) } : {};
}

export function stateUpdateSchedulesEqual(left: unknown, right: unknown) {
  return canonicalStateUpdateScheduleIntent(left) === canonicalStateUpdateScheduleIntent(right);
}

/** A reference-only outbox must not discard the snapshot already held by its durable row. */
export function pinnedStateUpdateScheduleMetadata(row: unknown, intent: unknown): StateUpdateScheduleMetadata {
  const stored = stateUpdateScheduleMetadata(row), pending = stateUpdateScheduleMetadata(intent);
  if (Object.keys(stored).length && Object.keys(pending).length &&
      (canonicalScheduleMetadata(stateUpdateScheduleRequest(stored)) !== canonicalScheduleMetadata(stateUpdateScheduleRequest(pending)) ||
       (stored.scheduleApplication && pending.scheduleApplication &&
        canonicalScheduleMetadata(stored.scheduleApplication) !== canonicalScheduleMetadata(pending.scheduleApplication)))) {
    throw new StateUpdateScheduleReviewError();
  }
  return { ...stored, ...pending };
}

export function canonicalStateUpdateScheduleIntent(value: unknown) {
  const metadata = stateUpdateScheduleMetadata(value);
  return canonicalScheduleMetadata({ ...metadata, ...stateUpdateScheduleRequest(metadata) });
}

/** Equality must also identify an unsupported command so it can fail safely without blocking the queue. */
export function stateUpdateScheduleIntentFingerprint(value: unknown): string | undefined {
  if (!object(value)) return undefined;
  const raw = {
    ...(value.schedule !== undefined ? { schedule: value.schedule } : {}),
    ...(value.scheduleApplication !== undefined ? { scheduleApplication: value.scheduleApplication } : {}),
  };
  if (!Object.keys(raw).length) return undefined;
  try {
    return canonicalStateUpdateScheduleIntent(raw);
  } catch (error) {
    if (!(error instanceof StateUpdateScheduleReviewError)) throw error;
    // This is an opaque equality key, never a validated input for persistence or transport.
    return canonicalScheduleMetadata(raw);
  }
}

/** Optional entity policy. It never participates in the report's identity. */
export type StateUpdateSchedulePolicy = {
  schemaVersion: 1; kind: "consumer"; bindingId: string; catalogEntityTypeId: string;
  sourceFieldId: string; dateFieldId: string; activeFrom: string;
  optionBindings: {optionId: string; scheduleRecordId: string}[];
  requirement: "required-for-new-records"; operationalDatePolicy: "explicit-start-date"; durationPolicy: "civil-clock";
};
export type StateUpdateScheduleResolution = {
  schemaVersion: 1; bindingId: string; sourceFieldId: string; dateFieldId: string;
  operationalDate: string; optionId?: string; status: "resolved" | "unavailable" | "context-required";
  reason?: string; effectiveFrom?: string; effectiveUntil?: string; application?: StateUpdateScheduleApplication;
};
export type CachedStateUpdateScheduleContext = { resolution: StateUpdateScheduleResolution; refreshedAt: string };

export function validateScheduleResolution(policy: StateUpdateSchedulePolicy, resolution: StateUpdateScheduleResolution | undefined,
  scope: { date?: string; identity?: {values:Record<string,string>} }) {
  if (!resolution || resolution.schemaVersion !== 1 || resolution.bindingId !== policy.bindingId ||
    resolution.sourceFieldId !== policy.sourceFieldId || resolution.dateFieldId !== policy.dateFieldId ||
    resolution.operationalDate !== scope.date || !scope.identity?.values[policy.sourceFieldId] ||
    resolution.optionId !== scope.identity.values[policy.sourceFieldId] || !["resolved","unavailable"].includes(resolution.status)) throw new StateUpdateScheduleReviewError();
  if (resolution.status === "resolved") {
    const metadata = stateUpdateScheduleMetadata({scheduleApplication:resolution.application});
    const applied = metadata.scheduleApplication;
    if (!applied || "kind" in applied || applied.bindingId !== policy.bindingId || applied.operationalDate !== scope.date ||
      !policy.optionBindings.some(binding=>binding.optionId===resolution.optionId && binding.scheduleRecordId===applied.scheduleRecordId)) throw new StateUpdateScheduleReviewError();
  } else if (resolution.application !== undefined) throw new StateUpdateScheduleReviewError();
  return resolution;
}

export function scheduleForStateUpdateEdit(response: {schedulePolicy?:StateUpdateSchedulePolicy;scheduleResolution?:StateUpdateScheduleResolution;date?:string;identityContext?:{values:Record<string,string>}|null},
  current: StateUpdateScheduleMetadata | null) {
  if (!response.schedulePolicy) return stateUpdateScheduleMetadata(current);
  if (current) {
    const metadata = stateUpdateScheduleMetadata(current);
    if (!metadata.scheduleApplication) throw new StateUpdateScheduleReviewError();
    return metadata;
  }
  const resolution=validateScheduleResolution(response.schedulePolicy,response.scheduleResolution,{date:response.date,identity:response.identityContext??undefined});
  if (resolution.status!=="resolved" || !resolution.application) throw new Error("No hay un horario aplicable preparado para esta fecha. Revisa el contexto con conexión antes de crear un reporte.");
  return stateUpdateScheduleMetadata({scheduleApplication:resolution.application});
}

export function formatAppliedSchedule(application: StateUpdateScheduleApplication | undefined) {
  if (!application) return "Horario no verificado para este reporte.";
  if ("kind" in application) return "Horario no registrado (reporte anterior a la activación).";
  const a=application.applied;
  return `${a.name} · ${a.startTime}–${a.endTime}${a.endDayOffset ? " (+1 día)" : ""} · ${a.nominalMinutes / 60} h nominales · ${a.timeZone}`;
}
