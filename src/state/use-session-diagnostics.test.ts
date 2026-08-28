import { afterEach, describe, expect, it, vi } from "vitest";

import { shouldShowStateUpdateDiagnostics } from "./use-session-diagnostics";

describe("session diagnostics controller helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps diagnostics observation opt-in from the query flag", () => {
    vi.stubGlobal("window", {
      location: {
        search: "?stateUpdateDiagnostics=1",
      },
    });

    expect(shouldShowStateUpdateDiagnostics()).toBe(true);
  });

  it("does not enable diagnostics observation on mount without the query flag", () => {
    vi.stubGlobal("window", {
      location: {
        search: "?recordsDiagnostics=1",
      },
    });

    expect(shouldShowStateUpdateDiagnostics()).toBe(false);
  });
});
