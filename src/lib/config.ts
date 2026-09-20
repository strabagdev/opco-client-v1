import { resolveClientApiUrl, trimTrailingSlash } from "./development-target";

export const config = {
  apiUrl: resolveClientApiUrl({
    EXPO_PUBLIC_OPCO_API_URL: process.env.EXPO_PUBLIC_OPCO_API_URL,
    EXPO_PUBLIC_OPCO_ENV: process.env.EXPO_PUBLIC_OPCO_ENV,
    NODE_ENV: process.env.NODE_ENV,
  }),
};

export { trimTrailingSlash };
