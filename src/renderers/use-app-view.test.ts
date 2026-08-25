import { describe, expect, it } from "vitest";

import { appViewsFixture } from "../test/fixtures";

import { resolveAppViewLoadError } from "./use-app-view-state";

describe("useAppView load error resolution", () => {
  it("does not block a cached AppView just because prewarm definitions are missing", () => {
    expect(
      resolveAppViewLoadError({
        appView: appViewsFixture[0],
        error: null,
        isLoading: false,
      }),
    ).toBeNull();
  });

  it("reports an unassigned AppView only after navigation loading completes", () => {
    expect(
      resolveAppViewLoadError({
        appView: null,
        error: null,
        isLoading: false,
      }),
    ).toBe("Esta experiencia no esta asignada para este contrato.");
  });
});
