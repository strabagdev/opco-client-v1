import { AppView } from "../lib/opco-api";

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
