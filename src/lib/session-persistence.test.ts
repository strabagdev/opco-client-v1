import { describe, expect, it, vi } from "vitest";

import { persistSelectedContractId, readPersistedContractId } from "./session-persistence";

describe("session persistence", () => {
  it("reads persisted contract ids", async () => {
    await expect(
      readPersistedContractId({
        getSelectedContractId: vi.fn(async () => "contract_1"),
        setSelectedContractId: vi.fn(),
      }),
    ).resolves.toBe("contract_1");
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
    await expect(
      persistSelectedContractId(
        {
          getSelectedContractId: vi.fn(),
          setSelectedContractId: vi.fn(async () => {
            throw new Error("sqlite unavailable");
          }),
        },
        "contract_1",
      ),
    ).resolves.toBeUndefined();
  });
});
