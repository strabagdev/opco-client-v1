export const config = {
  offlineGenericReusePolicy: process.env.EXPO_PUBLIC_OFFLINE_GENERIC_REUSE_POLICY === "verified-coverage-runtime-v1",
  offlineReusePolicy: process.env.EXPO_PUBLIC_OFFLINE_REUSE_POLICY === "attendance-runtime-v1",
  apiUrl: trimTrailingSlash(process.env.EXPO_PUBLIC_OPCO_API_URL ?? ""),
};

export function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
