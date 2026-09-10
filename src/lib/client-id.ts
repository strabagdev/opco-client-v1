import { config } from "./config";

export const CLIENT_ID_QUERY_PARAM = "clientId";
export const CLIENT_ID_PATTERN = /^opco_app_[A-Za-z0-9_-]{16,}$/;

export function isValidOpcoClientId(value: string | null | undefined) {
  return typeof value === "string" && CLIENT_ID_PATTERN.test(value.trim());
}

export function normalizeOpcoClientId(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";

  return isValidOpcoClientId(normalized) ? normalized : null;
}

export function clientIdFromUrl(url: string | null | undefined) {
  if (!url) {
    return null;
  }

  try {
    return normalizeOpcoClientId(new URL(url).searchParams.get(CLIENT_ID_QUERY_PARAM));
  } catch {
    return null;
  }
}

export function clientIdFromCurrentLocation() {
  if (typeof window === "undefined") {
    return null;
  }

  return normalizeOpcoClientId(new URLSearchParams(window.location.search).get(CLIENT_ID_QUERY_PARAM));
}

export function resolveEffectiveClientId({
  fallbackClientId = config.clientId,
  persistedClientId,
  urlClientId,
}: {
  fallbackClientId?: string;
  persistedClientId?: string | null;
  urlClientId?: string | null;
}) {
  return normalizeOpcoClientId(urlClientId) ??
    normalizeOpcoClientId(persistedClientId) ??
    normalizeOpcoClientId(fallbackClientId) ??
    "";
}
