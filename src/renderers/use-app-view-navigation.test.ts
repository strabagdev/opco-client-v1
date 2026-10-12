import { beforeEach, describe, expect, it, vi } from "vitest";
import { appViewsFixture } from "../test/fixtures";
import { useAppView } from "./use-app-view";

const state = vi.hoisted(() => ({
  effects: [] as (() => (() => void) | undefined)[],
  publish: vi.fn(),
  api: { getAppViews: vi.fn() },
  cache: { getAppViews: vi.fn(), upsertAppViews: vi.fn() },
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: () => (() => void) | undefined) => { state.effects.push(effect); },
  useState: (value: unknown) => [value, vi.fn()],
  useMemo: (compute: () => unknown) => compute(),
}));
vi.mock("../components/desktop-navigation", () => ({ usePublishDesktopCatalog: () => state.publish }));
vi.mock("@/lib/app-navigation-cache", async () => import("../lib/app-navigation-cache"));
vi.mock("@/lib/contract-selection", async () => import("../lib/contract-selection"));
vi.mock("@/state/session", () => ({ useSession: () => ({
  api: state.api, definitionCache: state.cache, ownerKey: "owner-a", selectedContractId: "contract-a",
  status: "authenticated", token: "synthetic-token", context: { contracts: [{ id: "contract-a" }] },
}) }));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => { vi.clearAllMocks(); state.effects = []; state.cache.getAppViews.mockResolvedValue(null); state.cache.upsertAppViews.mockResolvedValue(undefined); });

describe("direct experience route publishes its existing authorized load", () => {
  it("publishes the complete assigned remote catalog without another API request", async () => {
    state.api.getAppViews.mockResolvedValue({ views: appViewsFixture });
    useAppView(appViewsFixture[0].id);
    state.effects[0]();
    await settle();
    expect(state.api.getAppViews).toHaveBeenCalledTimes(1);
    expect(state.publish).toHaveBeenCalledWith(JSON.stringify(["owner-a", "contract-a"]), expect.arrayContaining(appViewsFixture));
  });
  it("publishes the real cached catalog through the existing fallback", async () => {
    state.cache.getAppViews.mockResolvedValue({ views: appViewsFixture, syncedAt: "2026-10-12T00:00:00Z" });
    state.api.getAppViews.mockRejectedValue(new Error("synthetic network unavailable"));
    useAppView(appViewsFixture[0].id);
    state.effects[0]();
    await settle();
    expect(state.api.getAppViews).toHaveBeenCalledTimes(1);
    expect(state.publish).toHaveBeenCalledWith(JSON.stringify(["owner-a", "contract-a"]), expect.arrayContaining(appViewsFixture));
  });
  it("does not publish a late route response after cleanup or scope change", async () => {
    let resolve!: (value: { views: typeof appViewsFixture }) => void;
    state.api.getAppViews.mockImplementation(() => new Promise(done => { resolve = done; }));
    useAppView(appViewsFixture[0].id);
    const cleanup = state.effects[0]();
    cleanup?.();
    resolve({ views: appViewsFixture });
    await settle();
    expect(state.publish).not.toHaveBeenCalled();
    expect(state.api.getAppViews).toHaveBeenCalledTimes(1);
  });
});
