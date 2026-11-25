import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AppView, EntityField, OpcoApi } from "@/lib/opco-api";
import type { OfflineRecordStore } from "@/lib/offline-records";
import type { LocalDatabase } from "@/lib/local-db";
import { catalogCoverageMessage, type CatalogLocalFact } from "../../../lib/app-view-definitions-cache";
import { loadStateUpdateRelationPage, localRelationSelection, RelationSelectionError } from "../../../lib/state-update-relations";

type Catalog = { loaded: boolean; options: { id: string; displayName: string }[]; error: string | null; loading: boolean; hasMore: boolean; offline: boolean };
export function useExtraRelations(input: {
  api: OpcoApi; store: OfflineRecordStore & Partial<Pick<LocalDatabase, "getLocalCatalogCoverage">>; token: string | null; ownerKey: string | null; contractId: string | null;
  fields: EntityField[]; online: boolean; scope: string; appView?: AppView; authGeneration?: number; identity?: "record"; selected?: Record<string, string[]>;
}) {
  const { api, store, token, ownerKey, contractId, online, scope, authGeneration, identity } = input;
  const fieldsKey = JSON.stringify(input.fields.filter(field => field.type === "RELATION"));
  const fields: EntityField[] = useMemo(() => JSON.parse(fieldsKey), [fieldsKey]);
  const selectionKey = JSON.stringify(input.selected ?? {}), viewKey = JSON.stringify(input.appView ?? null);
  const generation = authGeneration ?? api.getAuthSessionGeneration?.();
  const catalogScope = JSON.stringify([scope, ownerKey, contractId, generation, fieldsKey, identity, viewKey]);
  const [queries, setQueries] = useState<{ scope: string; byField: Record<string, { search: string; page: number }> }>({ scope: catalogScope, byField: {} });
  // Opaque request identity: never place credentials in a serialized scope/key.
  const request = useMemo(() => ({}), [api, store, token, online, catalogScope, selectionKey, queries]);
  const requestRef = useRef<object | null>(request);
  useLayoutEffect(() => { requestRef.current = request; return () => { requestRef.current = null; }; }, [request]);
  const [state, setState] = useState<{ request: object; scope: string; catalogs: Record<string, Catalog>; facts: CatalogLocalFact[] | null }>({ request, scope: catalogScope, catalogs: {}, facts: [] });
  useEffect(() => {
    let active = true;
    const current = () => active && requestRef.current === request && (generation === undefined || api.isAuthSessionCurrent(generation));
    if (!ownerKey || !contractId || online && !token) return;
    const selected = JSON.parse(selectionKey) as Record<string, string[]>;
    const wanted = queries.scope === catalogScope ? queries.byField : {};
    void Promise.resolve().then(() => {
      if (current()) setState(previous => ({ request, scope: catalogScope, facts: previous.scope === catalogScope ? previous.facts : [], catalogs: Object.fromEntries(fields.map(field => [field.id, {
        options: previous.scope === catalogScope ? previous.catalogs[field.id]?.options ?? [] : [], loaded: false, loading: true, error: null, hasMore: false, offline: !online,
      }])) }));
    });
    void (async () => {
      const view = JSON.parse(viewKey) as AppView | null;
      if (view && store.getLocalCatalogCoverage) {
        try {
          const facts = await store.getLocalCatalogCoverage({ ownerKey, contractId, appViews: [view], isCurrent: current });
          if (current()) setState(p => ({ ...p, request, scope: catalogScope, facts: facts[view.id] ?? null }));
        } catch { if (current()) setState(p => ({ ...p, request, scope: catalogScope, facts: null })); }
      }
      for (const field of fields) {
        if (!current()) return;
        try {
          const result = await loadStateUpdateRelationPage({ api, store, token: token ?? "", ownerKey, contractId, field, online, identity, isCurrent: current, ...wanted[field.id] });
          const resolved = await localRelationSelection(store, {
            ownerKey, contractId, field, ids: selected[field.id] ?? [], identity, isCurrent: current, remote: { api, token: token ?? "", online },
          });
          if (current()) setState(previous => ({ request, scope: catalogScope, facts: previous.scope === catalogScope ? previous.facts : [], catalogs: {
            ...previous.catalogs, [field.id]: { ...result, loaded: true, error: "notice" in result ? result.notice : null, loading: false,
              options: [...new Map([...resolved, ...((wanted[field.id]?.page ?? 1) > 1 && previous.scope === catalogScope ? previous.catalogs[field.id]?.options ?? [] : []), ...result.options].map(option => [option.id, option])).values()],
            },
          } }));
        } catch (reason) {
          if (current()) setState(previous => ({ request, scope: catalogScope, facts: previous.scope === catalogScope ? previous.facts : [], catalogs: {
            ...previous.catalogs, [field.id]: { options: [], loaded: false, error: reason instanceof RelationSelectionError ? reason.message : "No se pudo comprobar la selección del catálogo autorizado. Su valor se conserva; reintenta con conexión.", loading: false, hasMore: false, offline: !online },
          } }));
        }
      }
    })();
    return () => { active = false; };
  }, [api, store, token, ownerKey, contractId, online, catalogScope, generation, identity, fields, queries, selectionKey, viewKey, request]);
  const local = state.scope === catalogScope && state.request === request ? state : null;
  const fieldIds = new Set(input.fields.map(f => f.id));
  const coverageNotice = local?.facts === null ? "No se pudo comprobar la cobertura local de los catálogos; se conservan las selecciones y los pendientes." : local?.facts.filter(f => f.required && fieldIds.has(f.fieldId)).map(catalogCoverageMessage).filter(Boolean).join(" ") || null;
  const selectionNotices = fields.filter(field => (input.selected?.[field.id]?.length ?? 0) > 0)
    .flatMap(field => local?.catalogs[field.id]?.error ? [`${field.name}: ${local.catalogs[field.id].error}`] : []);
  const dependencyNotice = [...new Set([coverageNotice, ...selectionNotices].filter(Boolean))].join(" ") || null;
  return {
    catalogs: local?.catalogs ?? Object.fromEntries(fields.map(field => [field.id, { loaded: false, options: [], error: null, loading: true, hasMore: false, offline: !online }])), dependencyNotice,
    search(fieldId: string, search: string) { setQueries(p => p.scope === catalogScope && p.byField[fieldId]?.search === search ? p : { scope: catalogScope, byField: { ...(p.scope === catalogScope ? p.byField : {}), [fieldId]: { search, page: 1 } } }); },
    more(fieldId: string) { setQueries(p => ({ scope: catalogScope, byField: { ...(p.scope === catalogScope ? p.byField : {}), [fieldId]: { search: p.scope === catalogScope ? p.byField[fieldId]?.search ?? "" : "", page: (p.scope === catalogScope ? p.byField[fieldId]?.page ?? 1 : 1) + 1 } } })); },
  };
}
