import { describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  OPERATIONAL_CORE_PRODUCTION_ORIGIN,
  securityHeaders,
} from "./web-security-headers.mjs";

describe("web security headers", () => {
  it("builds a restrictive CSP for the production API origin", () => {
    const policy = buildContentSecurityPolicy({
      apiUrl: OPERATIONAL_CORE_PRODUCTION_ORIGIN,
      includeUpgradeInsecureRequests: true,
    });

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain(`connect-src 'self' ${OPERATIONAL_CORE_PRODUCTION_ORIGIN}`);
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).not.toContain("*");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("allows an explicit non-production API origin without wildcard connect-src", () => {
    const policy = buildContentSecurityPolicy({
      apiUrl: "http://localhost:3000/api/v1",
      includeUpgradeInsecureRequests: false,
    });

    expect(policy).toContain(`connect-src 'self' ${OPERATIONAL_CORE_PRODUCTION_ORIGIN} http://localhost:3000`);
    expect(policy).not.toContain("connect-src *");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("ignores non-http API origins instead of widening connect-src", () => {
    const policy = buildContentSecurityPolicy({
      apiUrl: "javascript:alert(1)",
      includeUpgradeInsecureRequests: false,
    });

    expect(policy).toContain(`connect-src 'self' ${OPERATIONAL_CORE_PRODUCTION_ORIGIN}`);
    expect(policy).not.toContain("javascript:");
    expect(policy).not.toContain("*");
  });

  it("exposes CSP, isolation, referrer, and MIME-sniffing headers together", () => {
    const headers = securityHeaders({
      apiUrl: OPERATIONAL_CORE_PRODUCTION_ORIGIN,
      includeUpgradeInsecureRequests: true,
    });

    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Cross-Origin-Embedder-Policy"]).toBe("credentialless");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });
});
