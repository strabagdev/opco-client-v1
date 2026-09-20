export type ClientEnvironment = {
  EXPO_PUBLIC_OPCO_API_URL?: string;
  EXPO_PUBLIC_OPCO_ENV?: string;
  NODE_ENV?: string;
};

export function resolveClientApiUrl(env: ClientEnvironment) {
  const value = trimTrailingSlash(env.EXPO_PUBLIC_OPCO_API_URL ?? "");
  const isLocal = env.EXPO_PUBLIC_OPCO_ENV === "local" || env.NODE_ENV === "development";

  if (!isLocal) return value;
  if (!value) throw new Error("EXPO_PUBLIC_OPCO_API_URL is required for local Client development.");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("EXPO_PUBLIC_OPCO_API_URL must be a valid URL.");
  }

  const authorized = url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    && url.port === "3000"
    && (url.pathname === "/" || url.pathname === "");

  if (!authorized) {
    throw new Error("Local Client development only allows loopback Core on port 3000.");
  }

  return value;
}

export function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
