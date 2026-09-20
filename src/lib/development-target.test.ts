import { describe, expect, it } from "vitest";

import { resolveClientApiUrl } from "./development-target";

describe("local Client API target", () => {
  it.each([
    "http://localhost:3000/",
    "http://127.0.0.1:3000/",
  ])("accepts the explicit local Core origin %s", (apiUrl) => {
    expect(resolveClientApiUrl({
      EXPO_PUBLIC_OPCO_API_URL: apiUrl,
      EXPO_PUBLIC_OPCO_ENV: "local",
    })).toBe(apiUrl.replace(/\/+$/, ""));
  });

  it.each([
    "https://client.opco.cl",
    "https://operational-core-production.example.com",
    "http://127.0.0.1:3001",
    "http://192.168.1.20:3000",
  ])("rejects %s in local mode", (apiUrl) => {
    expect(() => resolveClientApiUrl({
      EXPO_PUBLIC_OPCO_API_URL: apiUrl,
      EXPO_PUBLIC_OPCO_ENV: "local",
    })).toThrow("only allows loopback Core on port 3000");
  });

  it("does not alter a production deployment target", () => {
    expect(resolveClientApiUrl({
      EXPO_PUBLIC_OPCO_API_URL: "https://web.opco.cl",
      EXPO_PUBLIC_OPCO_ENV: "production",
      NODE_ENV: "production",
    })).toBe("https://web.opco.cl");
  });
});
