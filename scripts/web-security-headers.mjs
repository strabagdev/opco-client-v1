export const OPERATIONAL_CORE_PRODUCTION_ORIGIN = "https://web.opco.cl";

export function buildContentSecurityPolicy({
  apiUrl = process.env.EXPO_PUBLIC_OPCO_API_URL,
  includeUpgradeInsecureRequests = process.env.NODE_ENV === "production",
} = {}) {
  const connectSources = ["'self'", OPERATIONAL_CORE_PRODUCTION_ORIGIN];
  const apiOrigin = getHttpOrigin(apiUrl);

  if (apiOrigin && !connectSources.includes(apiOrigin)) {
    connectSources.push(apiOrigin);
  }

  const directives = [
    ["default-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["form-action", ["'self'"]],
    ["script-src", ["'self'", "'wasm-unsafe-eval'"]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", connectSources],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["media-src", ["'self'", "blob:"]],
  ];

  if (includeUpgradeInsecureRequests) {
    directives.push(["upgrade-insecure-requests", []]);
  }

  return directives
    .map(([name, values]) => values.length > 0 ? `${name} ${values.join(" ")}` : name)
    .join("; ");
}

export function securityHeaders(options = {}) {
  return {
    "Content-Security-Policy": buildContentSecurityPolicy(options),
    "Cross-Origin-Embedder-Policy": "credentialless",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function getHttpOrigin(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}
