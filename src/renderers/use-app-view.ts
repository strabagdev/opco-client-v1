import { useEffect, useMemo, useState } from "react";

import { sortAppViews } from "@/lib/app-views";
import { AppView } from "@/lib/opco-api";
import { useSession } from "@/state/session";

export function useAppView(appViewId: string | undefined) {
  const { api, selectedContractId, token } = useSession();
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
      if (!token || !selectedContractId || !appViewId) {
        setError("Selecciona un contrato antes de abrir una experiencia.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const data = await api.getAppViews(token, selectedContractId);

        if (isMounted) {
          setViews(sortAppViews(data.views));
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
  }, [api, appViewId, retryCount, selectedContractId, token]);

  return {
    appView,
    error: !isLoading && !error && !appView ? "Esta experiencia no esta asignada para este contrato." : error,
    isLoading,
    retry: () => setRetryCount((count) => count + 1),
  };
}
