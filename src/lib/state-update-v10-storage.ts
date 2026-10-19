import { compositeIdentityKey } from "./state-update-identity";
import type * as SQLite from "expo-sqlite";
import { normalizePreparedAppViewDefinition } from "./app-view-definitions-cache";
import type { EntityRecordRow } from "./local-db";
import type { StateUpdateScope, StateUpdateProjectionDefinition } from "./state-update-offline";
import { normalizeStateUpdateLogicalDate, usesDatedSubjectHistory } from "./state-update-offline";

const SNAPSHOT = "state_update_v10_snapshot:";
const CURRENT = "state_update_v10_current:";
const REMOTE = "state_update_v10_remote:";
const MANIFEST = "state_update_v10_manifest:";
type Envelope = { format: 1; verified: boolean; row: EntityRecordRow; key?: string };
export type V10StateScope = StateUpdateScope & { configuration: string };

export function stateUpdateLogicalRemoteId(row: Pick<EntityRecordRow, "server_id" | "values_json">) {
  const values = JSON.parse(row.values_json);
  const binding = values.__opcoStateUpdateRemote;
  return typeof values.appViewId === "string" && typeof values.subjectRecordId === "string" &&
    Array.isArray(values.stateValues) && binding?.format === 1 && typeof binding.recordId === "string"
    ? binding.recordId as string : row.server_id;
}
export function stateUpdateRemoteBinding(recordId: string) {
  return { format: 1 as const, recordId };
}
const parts = (s: V10StateScope) => [s.ownerKey, s.contractId, s.targetEntityTypeId, s.appViewId, s.configuration];
const snapshotKey = (s: V10StateScope, id: string) => SNAPSHOT + JSON.stringify([...parts(s), id]);
const currentKey = (s: V10StateScope, subject: string) => CURRENT + JSON.stringify([...parts(s), normalizeStateUpdateLogicalDate(s.date) ?? null, subject]);
const manifestKey = (s: V10StateScope) => MANIFEST + JSON.stringify([...parts(s), usesDatedSubjectHistory(s) ? null : normalizeStateUpdateLogicalDate(s.date) ?? null]);
async function read<T>(db: SQLite.SQLiteDatabase, key: string): Promise<T | null> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_metadata WHERE key = ?", key);
  if (!row?.value) return null;
  try { return JSON.parse(row.value) as T; } catch { return null; }
}
async function write(db: SQLite.SQLiteDatabase, key: string, value: unknown) {
  await db.runAsync("INSERT INTO app_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, JSON.stringify(value));
}
export async function stateUpdateV10Scope(db: SQLite.SQLiteDatabase, input: StateUpdateScope, definition?: StateUpdateProjectionDefinition): Promise<V10StateScope> {
  const cached = await db.getFirstAsync<{ definition_json: string }>(
    "SELECT definition_json FROM app_view_definitions WHERE owner_key=? AND contract_id=? AND app_view_id=?",
    input.ownerKey, input.contractId, input.appViewId,
  );
  let fields: unknown = null;
  let configuredDateFieldId: string | undefined;
  let cachedMode: StateUpdateScope["historyMode"], cachedUniqueness: StateUpdateScope["uniqueness"];
  try {
    const d = cached?.definition_json ? normalizePreparedAppViewDefinition(JSON.parse(cached.definition_json)) : null;
    const cachedDefinition = d?.kind === "state-update" && d.targetEntityTypeId === input.targetEntityTypeId ? d : null;
    const selected = definition ?? cachedDefinition;
    if (selected) {
      const d = selected;
      const config = cachedDefinition?.appView.config;
      const observation = definition ? definition.observationFieldId : (config && "workflowKey" in config && config.workflowKey === "attendance" && "observationFieldId" in config ? config.observationFieldId : undefined);
      configuredDateFieldId = d.dateFieldId;
      if (!definition && cachedDefinition) { cachedMode = cachedDefinition.historyMode; cachedUniqueness = cachedDefinition.uniqueness; }
      fields = [d.sourceEntityTypeId, d.subjectFieldId, d.dateFieldId ?? null,
        d.stateFields?.map((f: { fieldId: string; required: boolean }) => [f.fieldId, f.required]),
        [...(d.extraFields?.map((f: { id: string; required: boolean }) => [f.id, f.required]) ?? []), ...(observation ? [[observation, false]] : [])]];
    }
  } catch { /* Unknown cached definition cannot certify additional configuration. */ }
  const effective = { ...input, dateFieldId: input.dateFieldId ?? configuredDateFieldId, historyMode: input.historyMode ?? cachedMode, uniqueness: input.uniqueness ?? cachedUniqueness };
  return { ...effective, configuration: JSON.stringify([
    effective.historyMode ?? "update-current", effective.uniqueness ?? (effective.date ? "subject-date" : "subject"),
    usesDatedSubjectHistory(effective) ? effective.dateFieldId : null, fields,
    ...(effective.uniqueness === "subject-date-fields" ? [compositeIdentityKey(effective.identity)] : []),
  ]) };
}
export function stateUpdateEventDate(row: EntityRecordRow, scope: StateUpdateScope) {
  const v = JSON.parse(row.values_json);
  if (!usesDatedSubjectHistory(scope)) return normalizeStateUpdateLogicalDate(v.date);
  const field = v.stateValues?.find((f: { fieldId: string }) => f.fieldId === scope.dateFieldId);
  return normalizeStateUpdateLogicalDate(typeof field?.value === "string" ? field.value : undefined) ??
    (v.snapshotDateFieldId === scope.dateFieldId ? normalizeStateUpdateLogicalDate(v.snapshotEventDate) : undefined);
}
function compatibleConfiguration(stored: string, current: string) {
  if (stored === current) return true;
  try {
    const a = JSON.parse(stored), b = JSON.parse(current);
    if (a[1] === "subject-date-fields" || b[1] === "subject-date-fields") return false;
    // First preparation persists before caching its definition. Preserve that known mode/date
    // instead of making those snapshots disappear when the same definition becomes available.
    return a[3] === null && a.slice(0, 3).every((value: unknown, index: number) => value === b[index]);
  } catch { return false; }
}
export async function stateUpdateSnapshots(db: SQLite.SQLiteDatabase, scope: V10StateScope): Promise<Envelope[]> {
  const prefix = SNAPSHOT + JSON.stringify(parts(scope).slice(0, 4)).slice(0, -1) + ",";
  const rows = await db.getAllAsync<{ key: string; value: string }>("SELECT key,value FROM app_metadata WHERE substr(key,1,length(?))=?", prefix, prefix);
  const found = new Map<string, Envelope>();
  for (const r of rows) {
    try {
      const value = JSON.parse(r.value) as Envelope;
      const config = JSON.parse(r.key.slice(SNAPSHOT.length))[4] as string;
      if (value?.format !== 1 || !compatibleConfiguration(config, scope.configuration) ||
          value.row?.owner_key !== scope.ownerKey || value.row.contract_id !== scope.contractId ||
          value.row.entity_type_id !== scope.targetEntityTypeId || JSON.parse(value.row.values_json).appViewId !== scope.appViewId) continue;
      const v = JSON.parse(value.row.values_json), definition = JSON.parse(scope.configuration)[3];
      const fieldIds: [string, boolean][] = definition?.[3] ?? [], extras: [string, boolean][] = definition?.[4] ?? [];
      const verified = value.verified && fieldIds.every(([field]) => v.stateValues.some((f: { fieldId: string }) => f.fieldId === field) ||
        (field === scope.dateFieldId && !!stateUpdateEventDate(value.row, scope))) && extras.every(([field]) => Object.hasOwn(v.extraValues ?? {}, field));
      const entry = { ...value, verified, key: r.key }, id = stateUpdateLogicalRemoteId(value.row)!;
      const previous = found.get(id);
      if (!previous || (config === scope.configuration && JSON.parse(previous.key!.slice(SNAPSHOT.length))[4] !== config) ||
        Date.parse(value.row.remote_updated_at ?? "") > Date.parse(previous.row.remote_updated_at ?? "")) found.set(id, entry);
    } catch { /* Invalid or incompatible cache is not content proof. */ }
  }
  return [...found.values()];
}
export async function stateUpdateVirtualRecord(db: SQLite.SQLiteDatabase, input: { ownerKey: string; contractId: string; entityTypeId: string; recordId: string }) {
  // Resolve only an exact scoped virtual local_id. A global remote ID cannot choose an AppView.
  if (!input.recordId.startsWith("state_update_snapshot_")) return null;
  const prefix = SNAPSHOT + JSON.stringify([input.ownerKey, input.contractId, input.entityTypeId]).slice(0, -1) + ",";
  const rows = await db.getAllAsync<{ value: string }>("SELECT value FROM app_metadata WHERE substr(key,1,length(?))=?", prefix, prefix);
  for (const r of rows) {
    try { const p = JSON.parse(r.value) as Envelope; if (p?.format === 1 && p.row?.local_id === input.recordId) return p.row; } catch { /* Invalid cache is absent. */ }
  }
  try {
    const p = JSON.parse(input.recordId.slice("state_update_snapshot_".length));
    if (p[0] !== input.ownerKey || p[1] !== input.contractId || p[2] !== input.entityTypeId) return null;
    const cached = await read<Envelope>(db, SNAPSHOT + JSON.stringify(p));
    if (cached?.format === 1) return { ...cached.row, local_id: input.recordId };
  } catch { /* Unrecognized virtual identity is absent. */ }
  return null;
}
export async function rememberStateUpdateRemote(db: SQLite.SQLiteDatabase, scope: StateUpdateScope, recordId: string) {
  const key = REMOTE + JSON.stringify([scope.ownerKey, scope.contractId, scope.targetEntityTypeId, recordId]);
  await db.runAsync("INSERT INTO app_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING", key, JSON.stringify({ format: 1, recordId }));
}
export async function persistStateUpdateProjection(db: SQLite.SQLiteDatabase, scope: V10StateScope, row: EntityRecordRow, verified: boolean) {
  const id = stateUpdateLogicalRemoteId(row);
  if (!id) throw new Error("El snapshot de estado no tiene identidad remota.");
  await rememberStateUpdateRemote(db, scope, id);
  const prior = await read<Envelope>(db, snapshotKey(scope, id));
  // updatedAt resolves freshness of the SAME event, never selection of the workflow's current.
  if (prior?.format === 1 && Date.parse(prior.row.remote_updated_at ?? "") > Date.parse(row.remote_updated_at ?? "")) return;
  if (prior?.verified && !verified && prior.row.remote_updated_at === row.remote_updated_at) {
    await write(db, snapshotKey(scope, id), { ...prior, row: { ...prior.row, local_id: row.local_id } });
    return;
  }
  await write(db, snapshotKey(scope, id), { format: 1, verified, row } satisfies Envelope);
  const configuration = JSON.parse(scope.configuration);
  if (verified && configuration[3] !== null) {
    configuration[3] = null;
    await db.runAsync("DELETE FROM app_metadata WHERE key=?", snapshotKey({ ...scope, configuration: JSON.stringify(configuration) }, id));
  }
}
export async function persistStateUpdateAuthority(db: SQLite.SQLiteDatabase, scope: V10StateScope, subject: string, remoteId: string | null, verified: boolean, requiresCoverage = false) {
  await write(db, currentKey(scope, subject), { format: 1, verified, remoteId, requiresCoverage });
}
export async function stateUpdateAuthority(db: SQLite.SQLiteDatabase, scope: V10StateScope, subject: string) {
  const prefix = CURRENT + JSON.stringify(parts(scope).slice(0, 4)).slice(0, -1) + ",";
  const entries = await db.getAllAsync<{ key: string; value: string }>("SELECT key,value FROM app_metadata WHERE substr(key,1,length(?))=?", prefix, prefix);
  for (const row of entries.sort((a, b) => Number(b.key === currentKey(scope, subject)) - Number(a.key === currentKey(scope, subject)))) {
    try {
      const p = JSON.parse(row.key.slice(CURRENT.length));
      if (p[5] !== (normalizeStateUpdateLogicalDate(scope.date) ?? null) || p[6] !== subject || !compatibleConfiguration(p[4], scope.configuration)) continue;
      const r = JSON.parse(row.value) as { format: number; verified: boolean; remoteId: string | null; requiresCoverage?: boolean };
      if (r.format === 1 && r.verified && !r.requiresCoverage && (r.remoteId === null || typeof r.remoteId === "string")) return r;
    } catch { /* No authority from malformed markers. */ }
  }
  return null;
}
export async function stateUpdateRows(db: SQLite.SQLiteDatabase, input: StateUpdateScope): Promise<EntityRecordRow[]> {
  const scope = await stateUpdateV10Scope(db, input);
  const all = await db.getAllAsync<EntityRecordRow>(`SELECT * FROM entity_records WHERE owner_key=? AND contract_id=? AND entity_type_id=?`,
    scope.ownerKey, scope.contractId, scope.targetEntityTypeId);
  const legacy = all.filter(row => {
    const values = JSON.parse(row.values_json);
    return values.appViewId === scope.appViewId && (scope.uniqueness !== "subject-date-fields" || (!!scope.identity && compositeIdentityKey(values.identity) === compositeIdentityKey(scope.identity)));
  });
  const snapshots = await stateUpdateSnapshots(db, scope);
  const manifest = await read<{ ids: string[] }>(db, manifestKey(scope));
  const remote = new Map<string, EntityRecordRow>();
  for (const row of legacy.filter(r => r.sync_status === "synced")) {
    const id = stateUpdateLogicalRemoteId(row);
    if (id && (!manifest || manifest.ids.includes(id) ||
      (!usesDatedSubjectHistory(scope) && normalizeStateUpdateLogicalDate(JSON.parse(row.values_json).date) !== normalizeStateUpdateLogicalDate(scope.date)))) remote.set(id, row);
  }
  for (const projection of snapshots) {
    let row = projection.row;
    const id = stateUpdateLogicalRemoteId(row)!;
    const occupant = all.find(r => r.local_id === row.local_id);
    if (occupant && (JSON.parse(occupant.values_json).appViewId !== scope.appViewId ||
        (occupant.sync_status !== "synced" && stateUpdateLogicalRemoteId(occupant) !== id))) {
      const identity = projection.key ? JSON.parse(projection.key.slice(SNAPSHOT.length)) : [...parts(scope), id];
      row = { ...row, local_id: "state_update_snapshot_" + JSON.stringify(identity) };
    }
    const previous = remote.get(id);
    if (!previous || Date.parse(row.remote_updated_at ?? "") >= Date.parse(previous.remote_updated_at ?? "")) remote.set(id, row);
  }
  const pending = legacy.filter(r => r.sync_status !== "synced");
  for (const row of pending) {
    const id = stateUpdateLogicalRemoteId(row);
    if (id && (!scope.date || normalizeStateUpdateLogicalDate(JSON.parse(row.values_json).date) === normalizeStateUpdateLogicalDate(scope.date))) {
      remote.delete(id); // Display only this query's scoped overlay, never consume it from hydration.
    }
  }
  return [...remote.values(), ...pending];
}
export async function reconcileStateUpdateProjections(db: SQLite.SQLiteDatabase, scope: V10StateScope, ids: string[]) {
  const rows = await stateUpdateSnapshots(db, scope);
  let removed = 0;
  for (const { row, key } of rows) {
    if ((!usesDatedSubjectHistory(scope) && normalizeStateUpdateLogicalDate(JSON.parse(row.values_json).date) !== normalizeStateUpdateLogicalDate(scope.date)) ||
      ids.includes(stateUpdateLogicalRemoteId(row)!)) continue;
    await db.runAsync("DELETE FROM app_metadata WHERE key=?", key ?? snapshotKey(scope, stateUpdateLogicalRemoteId(row)!)); removed++;
  }
  // Hide stale legacy cache for this workflow without deleting shared rows/receipts or outbox.
  await write(db, manifestKey(scope), { ids });
  return removed;
}
export async function invalidateStateUpdateAuthorities(db: SQLite.SQLiteDatabase, scope: V10StateScope, subject: string) {
  const prefix = CURRENT + JSON.stringify(parts(scope).slice(0, 4)).slice(0, -1) + ",";
  const rows = await db.getAllAsync<{ key: string }>("SELECT key FROM app_metadata WHERE substr(key,1,length(?))=?", prefix, prefix);
  for (const row of rows) {
    try { const key = JSON.parse(row.key.slice(CURRENT.length)); if ((!scope.identity || key[4] === scope.configuration) && key.at(-1) === subject) await db.runAsync("DELETE FROM app_metadata WHERE key=?", row.key); } catch { /* Unrecognized marker is not authority. */ }
  }
  const coverageRows = await db.getAllAsync<{ key: string; value: string }>("SELECT key,value FROM app_metadata WHERE substr(key,1,30)='state_update_current_coverage:'");
  for (const row of coverageRows) {
    const key = JSON.parse(row.key.slice("state_update_current_coverage:".length));
    if (scope.identity && key[9] !== compositeIdentityKey(scope.identity)) continue;
    if (key[1] !== scope.contractId || key[2] !== scope.appViewId || key[4] !== scope.targetEntityTypeId) continue;
    // Scope keys contain an owner fingerprint; use the existing scope-specific snapshot key prefix above
    // and compare the fingerprint before changing coverage (same algorithm as local-db diagnostics).
    let owner = 0x811c9dc5; for (let n = 0; n < scope.ownerKey.length; n++) { owner ^= scope.ownerKey.charCodeAt(n); owner = Math.imul(owner, 0x01000193); }
    if (key[0] !== `fp_${(owner >>> 0).toString(16).padStart(8, "0")}`) continue;
    const value = JSON.parse(row.value);
    if (value.subjects?.[subject]) { value.subjects[subject] = { status: "failed" }; value.status = "partial"; await write(db, row.key, value); }
  }
}
