export type ReadLoadPresentation =
  | "content"
  | "empty"
  | "error"
  | "error-with-content"
  | "initial-loading"
  | "offline-content"
  | "offline-unavailable"
  | "refreshing";

export function resolveReadLoadPresentation({
  error,
  hasCompatibleData,
  isEmpty,
  isLoading,
  isOffline,
}: {
  error: string | null;
  hasCompatibleData: boolean;
  isEmpty: boolean;
  isLoading: boolean;
  isOffline: boolean;
}): ReadLoadPresentation {
  if (isLoading) return hasCompatibleData ? "refreshing" : "initial-loading";
  if (error) return hasCompatibleData ? "error-with-content" : "error";
  if (!hasCompatibleData && isOffline) return "offline-unavailable";
  if (isEmpty) return "empty";
  return isOffline ? "offline-content" : "content";
}
