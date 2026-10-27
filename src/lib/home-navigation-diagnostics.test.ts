import { describe, expect, it } from "vitest";
import { beginHomeNavigation, getHomeNavigationEvents, homeNavigationCachePresent, homeNavigationRows, recordHomeNavigation } from "./home-navigation-diagnostics";

describe("safe Home navigation diagnostics", () => {
  it("requires actual local evidence, including an empty list, instead of a selected contract", () => {
    const scope = beginHomeNavigation("proof-owner", "proof-contract");
    recordHomeNavigation(scope, { phase: "remote", result: "success", count: 3, syncedAt: null, errorCode: null });
    expect(homeNavigationCachePresent(getHomeNavigationEvents(), "proof-owner", "proof-contract")).toBe(false);
    recordHomeNavigation(scope, { phase: "cache_read", result: "valid", count: 0, syncedAt: "2026-10-26T12:00:00Z", errorCode: null });
    expect(homeNavigationCachePresent(getHomeNavigationEvents(), "proof-owner", "proof-contract")).toBe(true);
    recordHomeNavigation(scope, { phase: "cache_write", result: "error", count: 2, syncedAt: null, errorCode: "HOME_CACHE_WRITE_FAILED" });
    expect(homeNavigationCachePresent(getHomeNavigationEvents(), "proof-owner", "proof-contract")).toBe(true);
    recordHomeNavigation(scope, { phase: "cache_read", result: "error", count: null, syncedAt: null, errorCode: "HOME_CACHE_READ_FAILED" });
    expect(homeNavigationCachePresent(getHomeNavigationEvents(), "proof-owner", "proof-contract")).toBe(false);
    recordHomeNavigation(scope, { phase: "cache_write", result: "persisted", count: 2, syncedAt: "2026-10-26T12:00:00Z", errorCode: null });
    expect(homeNavigationCachePresent(getHomeNavigationEvents(), "proof-owner", "proof-contract")).toBe(true);
  });

  it("uses the exact scope, even when two diagnostic fingerprints collide", () => {
    const first = beginHomeNavigation("Aa", "same-contract");
    const second = beginHomeNavigation("BB", "same-contract");
    expect(first.ownerFingerprint).toBe(second.ownerFingerprint);
    for (const scope of [first, second]) recordHomeNavigation(scope, { phase: "cache_read", result: "valid", count: 1, syncedAt: "2026-10-26T12:00:00Z", errorCode: null });
    const firstText = JSON.stringify(homeNavigationRows(getHomeNavigationEvents(), "Aa", "same-contract"));
    expect(firstText).toContain(first.requestId);
    expect(firstText).not.toContain(second.requestId);
    expect(firstText).not.toContain("same-contract");
    expect(homeNavigationCachePresent(getHomeNavigationEvents(), "Aa", "other-contract")).toBe(false);
  });

  it("bounds diagnostic memory and includes a safe phase, count, time and correlation", () => {
    const scope = beginHomeNavigation("bounded-owner", "bounded-contract");
    for (let n = 0; n < 40; n++) recordHomeNavigation(scope, { phase: "cache_read", result: "valid", count: n, syncedAt: "2026-10-26T12:00:00Z", errorCode: null });
    expect(getHomeNavigationEvents()).toHaveLength(30);
    expect(getHomeNavigationEvents()[29]).toMatchObject({ requestId: scope.requestId, phase: "cache_read", count: 39, at: expect.any(String), ownerFingerprint: expect.stringMatching(/^fp_/), contractFingerprint: expect.stringMatching(/^fp_/) });
  });
});
