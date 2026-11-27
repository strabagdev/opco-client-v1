import { usePublishDesktopCatalog } from "../components/desktop-navigation";
import { useEffect, useMemo, useState } from "react";

import { loadAppViewsWithCache } from "@/lib/app-navigation-cache";
import { selectContractId } from "@/lib/contract-selection";
import { AppView } from "@/lib/opco-api";
import { useSession } from "@/state/session";

import { getAppViewBootstrapState, resolveAppViewLoadError } from "./use-app-view-state";
import { coherentCachedPanelViews } from "../lib/panel-definition";
import { revisionCanonical } from "../lib/revision-receipts";

export function useAppView(appViewId: string | undefined) {
  const { api, context, definitionCache, ownerKey, selectedContractId, status, token } = useSession();
  const publishCatalog = usePublishDesktopCatalog();
  const [catalog, setCatalog] = useState<{ scope: string; views: AppView[] }>({ scope: "", views: [] });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const bootstrapState = getAppViewBootstrapState({
    appViewId,
    context,
    ownerKey,
    selectedContractId,
    status,
    token,
  });
  const effectiveContractId = selectedContractId ?? (context ? selectContractId(context.contracts, selectedContractId) : null);
  const generation = api.getAuthSessionGeneration();
  const scope = JSON.stringify([ownerKey, effectiveContractId, appViewId, generation]);

  const appView = useMemo(
    () => bootstrapState === "ready" && catalog.scope === scope
      ? catalog.views.find((view) => view.id === appViewId) ?? null : null,
    [appViewId, bootstrapState, catalog, scope],
  );
  // Revalidating credentials is not another view or owner. The same resolved,
  // authorized scope keeps its renderer; denial/unassignment still retires it.
  const preserveResolvedView = Boolean(appView && !error);
  const loading = isLoading && !preserveResolvedView;

  useEffect(() => {
    let isMounted = true;
    let settled = false;
    let cachedViews: AppView[] | undefined;
    let coherentRead: Promise<AppView[]> | undefined;
    const current = () => isMounted && api.isAuthSessionCurrent(generation);
    function publish(views: AppView[]) {
      publishCatalog(JSON.stringify([ownerKey, effectiveContractId]), views);
      setCatalog(previous => ({ scope, views: views.map(view => {
        const old = previous.scope === scope ? previous.views.find(v => v.id === view.id) : undefined;
        return old && revisionCanonical(old) === revisionCanonical(view) ? old : view;
      }) }));
    }
    function resolveCached(views: AppView[]) {
      if (views !== cachedViews) {
        cachedViews = views;
        coherentRead = coherentCachedPanelViews(definitionCache, { ownerKey: ownerKey!, contractId: effectiveContractId! }, views, appViewId!);
      }
      return coherentRead!;
    }

    async function loadViews() {
      if (bootstrapState === "pending") {
        setError(null);
        setIsLoading(true);
        return;
      }

      if (bootstrapState === "missing-app-view") {
        setError("No fue posible cargar la experiencia.");
        setIsLoading(false);
        return;
      }

      if (bootstrapState === "missing-contract" || !token || !effectiveContractId || !appViewId || !ownerKey) {
        setError("Selecciona un contrato antes de abrir una experiencia.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const data = await loadAppViewsWithCache({
          api,
          cache: definitionCache,
          contractId: effectiveContractId,
          onCached(cached) {
            void resolveCached(cached.views).then(coherent => {
              if (current() && !settled && coherent.some(view => view.id === appViewId)) {
                publish(coherent);
                setIsLoading(false);
              }
            }).catch(() => { /* Remote/fallback below remains authoritative on a local read failure. */ });
          },
          ownerKey,
          token,
          isCurrent: current,
        });

        const coherent = data.fromCache
          ? await resolveCached(data.views)
          : data.views;
        settled = true;
        if (current()) {
          publish(coherent);
          setError(null);
        }
      } catch (nextError) {
        if (current()) {
          setCatalog({ scope, views: [] });
          setError(nextError instanceof Error ? nextError.message : "No fue posible cargar experiencias.");
        }
      } finally {
        if (current()) {
          setIsLoading(false);
        }
      }
    }

    void loadViews();

    return () => {
      isMounted = false;
    };
  }, [api, appViewId, bootstrapState, definitionCache, effectiveContractId, generation, ownerKey, publishCatalog, retryCount, scope, token]);

  return {
    appView,
    error: resolveAppViewLoadError({ appView, error, isLoading: loading }),
    isLoading: loading,
    retry: () => setRetryCount((count) => count + 1),
  };
}
