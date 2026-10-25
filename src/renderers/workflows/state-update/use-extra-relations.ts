import { useEffect, useMemo, useState } from "react";
import type { EntityField, OpcoApi } from "@/lib/opco-api";
import type { OfflineRecordStore } from "@/lib/offline-records";
import { loadStateUpdateRelationPage } from "../../../lib/state-update-relations";

type Catalog = { options: { id: string; displayName: string }[]; error: string | null; loading: boolean; hasMore: boolean; offline: boolean };
export function useExtraRelations(input: {
  api: OpcoApi; store: OfflineRecordStore; token: string | null; ownerKey: string | null; contractId: string | null;
  fields: EntityField[]; online: boolean; scope: string;
}) {
  const fieldsKey = JSON.stringify(input.fields.filter(field => field.type === "RELATION"));
  const fields: EntityField[] = useMemo(() => JSON.parse(fieldsKey), [fieldsKey]);
  const [queries, setQueries] = useState<Record<string, { search: string; page: number }>>({});
  const [state, setState] = useState<{ scope: string; catalogs: Record<string, Catalog> }>({ scope: input.scope, catalogs: {} });
  const { api, store, token, ownerKey, contractId, online, scope } = input;
  useEffect(() => {
    let current = true;
    if (!token || !ownerKey || !contractId || !fields.length) return;
    void Promise.resolve().then(() => { if (current) setState(previous => ({ scope, catalogs: Object.fromEntries(fields.map(field => [field.id, { options: previous.scope === scope ? previous.catalogs[field.id]?.options ?? [] : [], loading: true, error: null, hasMore: false, offline: !online }])) })); });
    void (async () => {
      for (const field of fields) {
        if (!current) return;
        try {
          const result = await loadStateUpdateRelationPage({ api, store, token, ownerKey, contractId, field, online, ...queries[field.id] });
          if (current) setState(previous => ({ scope, catalogs: { ...previous.catalogs, [field.id]: {
            ...result, error: null, loading: false,
            options: (queries[field.id]?.page ?? 1) > 1 ? [...new Map([...(previous.catalogs[field.id]?.options ?? []), ...result.options].map(option => [option.id, option])).values()] : result.options,
          } } }));
        } catch {
          if (current) setState(previous => ({ scope, catalogs: { ...previous.catalogs, [field.id]: { options: [], error: "No se pudo consultar el catálogo autorizado. Reintenta con conexión.", loading: false, hasMore: false, offline: !online } } }));
        }
      }
    })();
    return () => { current = false; };
    // Input objects change with workflow reads; only catalog/scope changes trigger catalog requests.
  }, [api, store, token, ownerKey, contractId, online, scope, fields, queries]);
  return {
    catalogs: state.scope === input.scope ? state.catalogs : {},
    search(fieldId: string, search: string) { setQueries(previous => previous[fieldId]?.search === search ? previous : { ...previous, [fieldId]: { search, page: 1 } }); },
    more(fieldId: string) { setQueries(previous => ({ ...previous, [fieldId]: { search: previous[fieldId]?.search ?? "", page: (previous[fieldId]?.page ?? 1) + 1 } })); },
  };
}
