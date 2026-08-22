import { describe, expect, it, vi } from "vitest";

import { persistSelectedContractId, readPersistedContractId } from "./session-persistence";

describe("session persistence", () => {
  it("reads persisted contract ids", async () => {
    const getSelectedContractId = vi.fn(async () => "contract_1");

    await expect(
      readPersistedContractId({
        getSelectedContractId,
        setSelectedContractId: vi.fn(),
      }, "org_1:user_1"),
    ).resolves.toBe("contract_1");
    expect(getSelectedContractId).toHaveBeenCalledWith("org_1:user_1");
  });

  it("does not fail auth flow when SQLite read fails", async () => {
    await expect(
      readPersistedContractId({
        getSelectedContractId: vi.fn(async () => {
          throw new Error("sqlite unavailable");
        }),
        setSelectedContractId: vi.fn(),
      }),
    ).resolves.toBeNull();
  });

  it("swallows SQLite write failures", async () => {
    const setSelectedContractId = vi.fn(async () => {
      throw new Error("sqlite unavailable");
    });

    await expect(
      persistSelectedContractId(
        {
          getSelectedContractId: vi.fn(),
          setSelectedContractId,
        },
        "contract_1",
        "org_1:user_1",
      ),
    ).resolves.toBeUndefined();
    expect(setSelectedContractId).toHaveBeenCalledWith("contract_1", "org_1:user_1");
  });
});
