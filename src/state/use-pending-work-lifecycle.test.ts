import { describe, expect, it } from "vitest";

import {
  isSessionLifecycleScopeCurrent,
  shouldRunForegroundPendingSync,
} from "./pending-work-lifecycle-logic";

describe("pending work lifecycle guards", () => {
  it("runs foreground sync only when returning active online without an in-flight sync", () => {
    expect(shouldRunForegroundPendingSync({
      connectivityStatus: "online",
      hasInFlightSync: false,
      nextAppState: "active",
      previousAppState: "background",
    })).toBe(true);

    expect(shouldRunForegroundPendingSync({
      connectivityStatus: "offline",
      hasInFlightSync: false,
      nextAppState: "active",
      previousAppState: "background",
    })).toBe(false);

    expect(shouldRunForegroundPendingSync({
      connectivityStatus: "online",
      hasInFlightSync: true,
      nextAppState: "active",
      previousAppState: "background",
    })).toBe(false);

    expect(shouldRunForegroundPendingSync({
      connectivityStatus: "online",
      hasInFlightSync: false,
      nextAppState: "active",
      previousAppState: "active",
    })).toBe(false);
  });

  it("prevents stale lifecycle runs from applying after logout or contract switch", () => {
    const runScope = {
      ownerKey: "org_1:user_1",
      selectedContractId: "contract_1",
      token: "token_1",
    };

    expect(isSessionLifecycleScopeCurrent(runScope, runScope)).toBe(true);
    expect(isSessionLifecycleScopeCurrent(runScope, { ...runScope, token: null })).toBe(false);
    expect(isSessionLifecycleScopeCurrent(runScope, { ...runScope, selectedContractId: "contract_2" })).toBe(false);
    expect(isSessionLifecycleScopeCurrent(runScope, { ...runScope, ownerKey: "org_1:user_2" })).toBe(false);
  });
});
