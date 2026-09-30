import { describe, expect, it } from "vitest";

import { resolveReadLoadPresentation } from "./read-load-presentation";

describe("read load presentation", () => {
  it("distinguishes initial loading from refresh with compatible content", () => {
    expect(resolve({ isLoading: true })).toBe("initial-loading");
    expect(resolve({ hasCompatibleData: true, isLoading: true })).toBe(
      "refreshing",
    );
  });

  it("stops loading on success, empty, and error", () => {
    expect(resolve({ hasCompatibleData: true })).toBe("content");
    expect(resolve({ hasCompatibleData: true, isEmpty: true })).toBe("empty");
    expect(resolve({ error: "falló" })).toBe("error");
    expect(resolve({ error: "falló", hasCompatibleData: true })).toBe(
      "error-with-content",
    );
  });

  it("represents offline content and explicit offline unavailability without loading", () => {
    expect(resolve({ hasCompatibleData: true, isOffline: true })).toBe(
      "offline-content",
    );
    expect(resolve({ isOffline: true })).toBe("offline-unavailable");
  });
});

function resolve(
  overrides: Partial<Parameters<typeof resolveReadLoadPresentation>[0]>,
) {
  return resolveReadLoadPresentation({
    error: null,
    hasCompatibleData: false,
    isEmpty: false,
    isLoading: false,
    isOffline: false,
    ...overrides,
  });
}
