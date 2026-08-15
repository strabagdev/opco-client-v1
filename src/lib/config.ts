export const config = {
  apiUrl: trimTrailingSlash(process.env.EXPO_PUBLIC_OPCO_API_URL ?? ""),
  clientId: process.env.EXPO_PUBLIC_OPCO_CLIENT_ID ?? "",
};

export function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
