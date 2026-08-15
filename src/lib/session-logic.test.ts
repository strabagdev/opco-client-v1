import { describe, expect, it, vi } from "vitest";

import { OpcoApiError } from "./opco-api";
import { restoreSession } from "./session-logic";

describe("restoreSession", () => {
  it("deletes the token when /me returns 401", async () => {
    const store = {
      deleteToken: vi.fn(async () => undefined),
      getToken: vi.fn(async () => "token_123"),
    };

    const result = await restoreSession(store, {
      getMe: async () => {
        throw new OpcoApiError("Token expirado.", "TOKEN_EXPIRED", 401);
      },
    });

    expect(result.status).toBe("anonymous");
    expect(store.deleteToken).toHaveBeenCalledOnce();
  });

  it("returns anonymous without calling /me when there is no token", async () => {
    const store = {
      deleteToken: vi.fn(async () => undefined),
      getToken: vi.fn(async () => null),
    };
    const api = {
      getMe: vi.fn(),
    };

    await expect(restoreSession(store, api)).resolves.toEqual({ status: "anonymous" });
    expect(api.getMe).not.toHaveBeenCalled();
    expect(store.deleteToken).not.toHaveBeenCalled();
  });

  it("keeps the token when /me fails because of network", async () => {
    const store = {
      deleteToken: vi.fn(async () => undefined),
      getToken: vi.fn(async () => "token_123"),
    };

    const result = await restoreSession(store, {
      getMe: async () => {
        throw new Error("network");
      },
    });

    expect(result).toEqual({ status: "offline", token: "token_123" });
    expect(store.deleteToken).not.toHaveBeenCalled();
  });
});
