export const config = {
  apiUrl: trimTrailingSlash(process.env.EXPO_PUBLIC_OPCO_API_URL ?? ""),
};

export function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
