import { describe, expect, it } from "vitest";

import { serviceWorkerSource } from "./generate-service-worker.mjs";

describe("service worker source", () => {
  it("keeps API requests network-only instead of caching them", () => {
    const source = serviceWorkerSource({
      buildHash: "test-build",
      precacheUrls: ["/", "/index.html", "/_expo/static/js/web/entry-test.js"],
    });

    expect(source).toContain('const API_HOSTS = new Set(["web.opco.cl"])');
    expect(source).toContain('url.pathname.startsWith("/api/")');
    expect(source).toContain('API_HOSTS.has(url.hostname) && url.pathname.startsWith("/api/v1/")');
    expect(source).toContain("return;");
    expect(source.indexOf('url.pathname.startsWith("/api/")')).toBeLessThan(source.indexOf("event.respondWith"));
  });

  it("does not precache token-bearing API paths", () => {
    const source = serviceWorkerSource({
      buildHash: "test-build",
      precacheUrls: ["/", "/index.html", "/manifest.json"],
    });

    expect(source).not.toContain("/api/v1/auth");
    expect(source).not.toContain("Authorization");
    expect(source).not.toContain("Bearer ");
  });
});
