import { selectContractId } from "../lib/contract-selection";
import { AppView, ContextResponse } from "../lib/opco-api";

type SessionStatus = "loading" | "anonymous" | "authenticated" | "offline";

export function getAppViewBootstrapState({
  appViewId,
  context,
  ownerKey,
  selectedContractId,
  status,
  token,
}: {
  appViewId: string | undefined;
  context: ContextResponse | null;
  ownerKey: string | null;
  selectedContractId: string | null;
  status: SessionStatus;
  token: string | null;
}): "pending" | "missing-app-view" | "missing-contract" | "ready" {
  if (!appViewId) {
    return "missing-app-view";
  }

  if (status === "loading" || !token || !context || !ownerKey) {
    return "pending";
  }

  if (!selectedContractId && selectContractId(context.contracts, null)) {
    return "pending";
  }

  return selectedContractId || selectContractId(context.contracts, selectedContractId) ? "ready" : "missing-contract";
}

export function resolveAppViewLoadError({
  appView,
  error,
  isLoading,
}: {
  appView: AppView | null;
  error: string | null;
  isLoading: boolean;
}) {
  return !isLoading && !error && !appView ? "Esta experiencia no esta asignada para este contrato." : error;
}
