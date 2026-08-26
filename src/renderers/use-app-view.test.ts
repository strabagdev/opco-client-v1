import { describe, expect, it } from "vitest";

import { appViewsFixture } from "../test/fixtures";

import { getAppViewBootstrapState, resolveAppViewLoadError } from "./use-app-view-state";

describe("useAppView load error resolution", () => {
  it("keeps direct AppView navigation loading while authenticated context is still bootstrapping", () => {
    expect(
      getAppViewBootstrapState({
        appViewId: "view_attendance",
        context: null,
        ownerKey: null,
        selectedContractId: null,
        status: "authenticated",
        token: "token_1",
      }),
    ).toBe("pending");
  });

  it("keeps loading while a single contract can still be selected automatically", () => {
    expect(
      getAppViewBootstrapState({
        appViewId: "view_attendance",
        context: {
          contracts: [{ id: "contract_1", name: "Contrato", role: "MEMBER" }],
          organization: { id: "org_1", name: "Org" },
        },
        ownerKey: "org_1:user_1",
        selectedContractId: null,
        status: "authenticated",
        token: "token_1",
      }),
    ).toBe("pending");
  });

  it("reports missing contract only after bootstrap is ready and no contract can be inferred", () => {
    expect(
      getAppViewBootstrapState({
        appViewId: "view_attendance",
        context: {
          contracts: [
            { id: "contract_1", name: "Contrato 1", role: "MEMBER" },
            { id: "contract_2", name: "Contrato 2", role: "MEMBER" },
          ],
          organization: { id: "org_1", name: "Org" },
        },
        ownerKey: "org_1:user_1",
        selectedContractId: null,
        status: "authenticated",
        token: "token_1",
      }),
    ).toBe("missing-contract");
  });

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
