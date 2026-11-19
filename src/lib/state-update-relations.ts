import { OpcoNetworkError } from "./opco-api";
import type { EntityField, EntityRecordValue, OpcoApi } from "./opco-api";
import type { OfflineRecordStore } from "./offline-records";
import { getRelationTargetEntityTypeId } from "./record-form";

export async function loadStateUpdateRelationPage(input: {
  api: Pick<OpcoApi, "getEntityRecords">; store: Pick<OfflineRecordStore, "upsertRemoteRecords" | "listCachedRecords">;
  token: string; ownerKey: string; contractId: string; field: EntityField; online: boolean; search?: string; page?: number;
}) {
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
    await input.store.upsertRemoteRecords({ ...scope, records: result.records });
    return { options: result.records.map(record => ({ id: record.id, displayName: record.displayName })), hasMore: result.pagination.page < result.pagination.totalPages, offline: false };
  }
  return cachedPage();
  async function cachedPage() {
    const result = await input.store.listCachedRecords({ ...scope, ...query });
    const options = result.records.filter(record => record.serverId).map(record => ({ id: record.serverId!, displayName: record.displayName }));
    return { options, hasMore: result.pagination.page < result.pagination.totalPages, offline: true,
      notice: options.length ? null : query.search ? "No hay coincidencias en las opciones guardadas de este dispositivo." : "No hay opciones guardadas en este dispositivo. Conéctate para cargar el catálogo; no se seleccionó ningún valor." };
  }
}

export function relationValueLabels(value: EntityRecordValue | undefined): { id: string; displayName: string }[] {
  return (Array.isArray(value) ? value : [value]).flatMap(item => item && typeof item === "object" && "id" in item && typeof item.id === "string" && "displayName" in item && typeof item.displayName === "string"
    ? [{ id: item.id, displayName: item.displayName }] : []);
}
