import { useEffect, useMemo, useState } from "react";

import { loadAppViewsWithCache } from "@/lib/app-navigation-cache";
import { selectContractId } from "@/lib/contract-selection";
import { AppView } from "@/lib/opco-api";
import { useSession } from "@/state/session";

import { getAppViewBootstrapState, resolveAppViewLoadError } from "./use-app-view-state";

export function useAppView(appViewId: string | undefined) {
  const { api, context, definitionCache, ownerKey, selectedContractId, status, token } = useSession();
  const [views, setViews] = useState<AppView[]>([]);
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

  const appView = useMemo(
    () => views.find((view) => view.id === appViewId) ?? null,
    [appViewId, views],
  );

  useEffect(() => {
    let isMounted = true;

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
          ownerKey,
          token,
        });

        if (isMounted) {
          setViews(data.views);
        }
      } catch (nextError) {
        if (isMounted) {
          setError(nextError instanceof Error ? nextError.message : "No fue posible cargar experiencias.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadViews();

    return () => {
      isMounted = false;
    };
  }, [api, appViewId, bootstrapState, definitionCache, effectiveContractId, ownerKey, retryCount, token]);

  return {
    appView,
    error: resolveAppViewLoadError({ appView, error, isLoading }),
    isLoading,
    retry: () => setRetryCount((count) => count + 1),
  };
}
