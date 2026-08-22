import { useEffect, useMemo, useState } from "react";

import { loadAppViewsWithCache } from "@/lib/app-navigation-cache";
import { AppView } from "@/lib/opco-api";
import { useSession } from "@/state/session";

export function useAppView(appViewId: string | undefined) {
  const { api, definitionCache, ownerKey, selectedContractId, token } = useSession();
  const [views, setViews] = useState<AppView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  const appView = useMemo(
    () => views.find((view) => view.id === appViewId) ?? null,
    [appViewId, views],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadViews() {
      if (!token || !selectedContractId || !appViewId || !ownerKey) {
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
          contractId: selectedContractId,
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
  }, [api, appViewId, definitionCache, ownerKey, retryCount, selectedContractId, token]);

  return {
    appView,
    error: !isLoading && !error && !appView ? "Esta experiencia no esta asignada para este contrato." : error,
    isLoading,
    retry: () => setRetryCount((count) => count + 1),
  };
}
