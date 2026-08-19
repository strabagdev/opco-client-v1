import { describe, expect, it, vi } from "vitest";

import { OpcoApiError } from "./opco-api";
import { restoreSession } from "./session-logic";

const meFixture = {
  app: {
    clientId: "opco_app_123",
    id: "app_1",
    name: "Materiales",
    slug: "materiales",
  },
  user: {
    email: "user@example.com",
    id: "user_1",
    name: null,
  },
};

const contextFixture = {
  contracts: [{ id: "contract_1", name: "Andes Norte", role: "ADMIN" as const }],
  organization: {
    id: "org_1",
    name: "Opco",
  },
};

describe("restoreSession", () => {
  it("deletes the token when /me returns 401", async () => {
    const store = {
      clearSession: vi.fn(async () => undefined),
      getAccessToken: vi.fn(async () => "token_123"),
    };

    const result = await restoreSession(store, {
      getMe: async () => {
        throw new OpcoApiError("Token expirado.", "TOKEN_EXPIRED", 401);
      },
    });

    expect(result.status).toBe("anonymous");
    expect(store.clearSession).toHaveBeenCalledOnce();
  });

  it("returns anonymous without calling /me when there is no token", async () => {
    const store = {
      clearSession: vi.fn(async () => undefined),
      getAccessToken: vi.fn(async () => null),
    };
    const api = {
      getMe: vi.fn(),
    };

    await expect(restoreSession(store, api)).resolves.toEqual({ status: "anonymous" });
    expect(api.getMe).not.toHaveBeenCalled();
    expect(store.clearSession).not.toHaveBeenCalled();
  });

  it("keeps the token when /me fails because of network", async () => {
    const store = {
      clearSession: vi.fn(async () => undefined),
      getAccessToken: vi.fn(async () => "token_123"),
    };

    const result = await restoreSession(store, {
      getMe: async () => {
        throw new Error("network");
      },
    });

    expect(result).toEqual({ status: "offline", token: "token_123" });
    expect(store.clearSession).not.toHaveBeenCalled();
  });

  it("returns the cached navigation snapshot when /me cannot be verified by network", async () => {
    const store = {
      clearSession: vi.fn(async () => undefined),
      getAccessToken: vi.fn(async () => "token_123"),
    };

    const result = await restoreSession(
      store,
      {
        getMe: async () => {
          throw new Error("network");
        },
      },
      {
        getContextSnapshot: async () => ({
          context: contextFixture,
          me: meFixture,
          syncedAt: "2026-08-19T12:00:00.000Z",
        }),
      },
    );

    expect(result).toEqual({
      snapshot: {
        context: contextFixture,
        me: meFixture,
        syncedAt: "2026-08-19T12:00:00.000Z",
      },
      status: "offline",
      token: "token_123",
    });
    expect(store.clearSession).not.toHaveBeenCalled();
  });

  it("returns the rotated access token when /me refreshes during bootstrap", async () => {
    const store = {
      clearSession: vi.fn(async () => undefined),
      getAccessToken: vi.fn().mockResolvedValueOnce("expired-token").mockResolvedValueOnce("fresh-token"),
    };

    const result = await restoreSession(store, {
      getMe: async () => meFixture,
    });

    expect(result).toMatchObject({ status: "authenticated", token: "fresh-token" });
  });
});
