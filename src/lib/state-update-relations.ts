import { OpcoApiError, OpcoNetworkError } from "./opco-api";
import type { EntityField, EntityRecordValue, OpcoApi } from "./opco-api";
import type { OfflineRecordStore } from "./offline-records";
import { getRelationTargetEntityTypeId } from "./record-form";

export async function loadStateUpdateRelationPage(input: {
  api: Pick<OpcoApi, "getEntityRecords">; store: Pick<OfflineRecordStore, "upsertRemoteRecords" | "listCachedRecords">;
  identity?: "record"; isCurrent?():boolean;
  token: string; ownerKey: string; contractId: string; field: EntityField; online: boolean; search?: string; page?: number;
}) {
  const current=()=>{if(input.isCurrent&&!input.isCurrent())throw new Error("La consulta del catálogo ya no está vigente.");};current();
  const entityTypeId = getRelationTargetEntityTypeId(input.field);
  if (!entityTypeId) throw new Error("Este campo no tiene un catálogo configurado.");
  const query = { page: input.page ?? 1, pageSize: 25, search: input.search?.trim() || undefined, sort: "displayName" as const, direction: "asc" as const };
  const scope = { ownerKey: input.ownerKey, contractId: input.contractId, entityTypeId };
  if (input.online) {
    // Authorization failures propagate. Never expose a cached catalog after a 403.
    let result;
    try {
      result = await input.api.getEntityRecords(input.token, input.contractId, entityTypeId, query);
    } catch (error) {
      if (!(error instanceof OpcoNetworkError)) throw error;
      return cachedPage();
    }
    current();
    await input.store.upsertRemoteRecords({ ...scope, records: result.records });
    current();
    return { options: result.records.map(record => ({ id: record.id, displayName: record.displayName })), hasMore: result.pagination.page < result.pagination.totalPages, offline: false };
  }
  return cachedPage();
  async function cachedPage() {
    current();
    const result = await input.store.listCachedRecords({ ...scope, ...query });
    current();
    const options = result.records.filter(record => input.identity === "record" || record.serverId).map(record => ({ id: record.serverId ?? record.localId, displayName: record.displayName }));
    return { options, hasMore: result.pagination.page < result.pagination.totalPages, offline: true,
      notice: options.length ? null : query.search ? "No hay coincidencias en las opciones guardadas de este dispositivo." : "No hay opciones guardadas en este dispositivo. Conéctate para cargar el catálogo; no se seleccionó ningún valor." };
  }
}

export function relationValueLabels(value: EntityRecordValue | undefined): { id: string; displayName: string }[] {
  return (Array.isArray(value) ? value : [value]).flatMap(item => item && typeof item === "object" && "id" in item && typeof item.id === "string" && "displayName" in item && typeof item.displayName === "string"
    ? [{ id: item.id, displayName: item.displayName }] : []);
}

export class RelationSelectionError extends Error {}

/** Resolve exact selected identities, never infer validity from a page or a label. */
export async function localRelationSelection(
  store: Pick<OfflineRecordStore, "getCachedRecord"> & Partial<Pick<OfflineRecordStore, "upsertRemoteRecords">>,
  input: {
    ownerKey: string; contractId: string; field: EntityField; ids: string[]; identity?: "record";
    isCurrent?(): boolean;
    remote?: { api: Pick<OpcoApi, "getEntityRecord">; token: string; online: boolean };
  },
) {
  const entityTypeId = getRelationTargetEntityTypeId(input.field);
  if (!entityTypeId) return [];
  const current = () => !input.isCurrent || input.isCurrent();
  const rows: { id: string; displayName: string }[] = [];
  for (const recordId of [...new Set(input.ids)]) {
    if (!current()) return [];
    const scope = { ownerKey: input.ownerKey, contractId: input.contractId, entityTypeId };
    let row = await store.getCachedRecord({ ...scope, recordId });
    if (!current()) return [];
    const localOnly = row && input.identity === "record" && !row.serverId && row.localId === recordId;
    if (input.remote?.online && !localOnly) {
      try {
        const remoteId = input.identity === "record" && row?.localId === recordId ? row.serverId ?? recordId : recordId;
        const response = await input.remote.api.getEntityRecord(input.remote.token, input.contractId, entityTypeId, remoteId);
        if (!current()) return [];
        if (response.record.id !== remoteId) throw new RelationSelectionError("No se pudo comprobar la identidad de la selección. Su valor se conserva.");
        // A target read hydrates the existing scoped cache; it never creates intent.
        await store.upsertRemoteRecords!({ ...scope, records: [response.record] });
        if (!current()) return [];
        row = await store.getCachedRecord({ ...scope, recordId });
      } catch (error) {
        if (!current()) return [];
        if (!(error instanceof OpcoNetworkError)) {
          if (error instanceof OpcoApiError && error.status === 404) {
            throw new RelationSelectionError("El registro seleccionado ya no está disponible en el catálogo. Su selección se conserva para revisión.");
          }
          throw new RelationSelectionError("No se pudo comprobar la selección con el catálogo autorizado. Su valor se conserva; reintenta con conexión.");
        }
        // Only network failure permits the same scoped local identity as fallback.
      }
    }
    if (!current()) return [];
    if (row && (row.serverId === recordId || input.identity === "record" && row.localId === recordId)) {
      rows.push({ id: recordId, displayName: row.displayName });
    } else if (input.remote) {
      throw new RelationSelectionError("La selección no está guardada en este dispositivo. Conéctate para comprobarla; no se eliminó ni se eligió otra opción.");
    }
  }
  return rows;
}
