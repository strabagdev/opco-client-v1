import { afterEach, describe, expect, it, vi } from "vitest";
import { BROWSER_PERSISTENCE_LABELS, formatEstimatedStorageBytes, readBrowserStorageDiagnostics, requestBrowserStoragePersistence } from "./browser-storage-diagnostics";

afterEach(() => vi.unstubAllGlobals());

describe("browser storage diagnostics without business storage", () => {
  it.each([true, false])("reads persistence=%s and estimates without requesting permission", async granted => {
    const api = { persisted: vi.fn(async () => granted), persist: vi.fn(async () => true), estimate: vi.fn(async () => ({ usage: 0, quota: 4096 })) };
    expect(await readBrowserStorageDiagnostics(api)).toEqual({ persistence: granted ? "granted" : "not-granted", usage: 0, quota: 4096, canRequest: true, queryFailed: false, estimateFailed: false, requestFailed: false });
    expect(api.persist).not.toHaveBeenCalled();
    expect(api.persisted.mock.contexts[0]).toBe(api);
    expect(api.estimate.mock.contexts[0]).toBe(api);
  });
  it.each([true, false])("requests explicitly and reports the observed result %s", async granted => {
    const calls: string[] = [];
    const api = { persisted: vi.fn(async () => { calls.push("persisted"); return granted; }), persist: vi.fn(async () => { calls.push("persist"); return granted; }), estimate: vi.fn(async () => ({ usage: 100, quota: 200 })) };
    const pending = requestBrowserStoragePersistence(api);
    expect(calls).toEqual(["persist"]); // Request starts within the action's gesture, before any await.
    expect((await pending).persistence).toBe(granted ? "granted" : "not-granted");
    expect(api.persist).toHaveBeenCalledTimes(1);
    expect(api.persist.mock.contexts[0]).toBe(api);
  });
  it("does not retain a granted flag when the next real observation is denied", async () => {
    const api = { persisted: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false) };
    expect((await readBrowserStorageDiagnostics(api)).persistence).toBe("granted");
    expect((await readBrowserStorageDiagnostics(api)).persistence).toBe("not-granted");
  });
  it("handles absent APIs and native/server contexts without requesting or writing anything", async () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("navigator", undefined);
    expect((await readBrowserStorageDiagnostics()).persistence).toBe("unavailable");
    expect((await requestBrowserStoragePersistence()).canRequest).toBe(false);
    expect(await readBrowserStorageDiagnostics({})).toMatchObject({ persistence: "unavailable", usage: null, quota: null, canRequest: false });
  });
  it("keeps available estimates if the persistence query throws, with no raw exception details", async () => {
    const snapshot = await readBrowserStorageDiagnostics({ persisted: async () => { throw Error("PRIVATE_TOKEN PRIVATE_PATH"); }, estimate: async () => ({ usage: 123, quota: 456 }) });
    expect(snapshot).toMatchObject({ persistence: "unknown", queryFailed: true, usage: 123, quota: 456 });
    expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE|TOKEN|PATH/);
  });
  it("does not lose persistence status if estimate throws", async () => {
    expect(await readBrowserStorageDiagnostics({ persisted: async () => false, estimate: async () => { throw Error("private"); } })).toMatchObject({ persistence: "not-granted", estimateFailed: true, usage: null, quota: null });
  });
  it("reports request exceptions as unknown and makes no silent retry", async () => {
    const api = { persist: vi.fn(async () => { throw Error("PRIVATE_REQUEST"); }), persisted: async () => false };
    const result = await requestBrowserStoragePersistence(api);
    expect(result).toMatchObject({ persistence: "unknown", requestFailed: true });
    expect(api.persist).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("treats a throwing storage getter as unknown rather than permission denial", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { get storage() { throw Error("private"); } });
    expect(await readBrowserStorageDiagnostics()).toMatchObject({ persistence: "unknown", queryFailed: true });
    expect((await requestBrowserStoragePersistence()).persistence).toBe("unknown");
  });
  it("does not invent persistence or capacity from malformed API values", async () => {
    expect(await readBrowserStorageDiagnostics({ persisted: async () => "yes", estimate: async () => ({ usage: -1, quota: Infinity }) })).toMatchObject({ persistence: "unknown", usage: null, quota: null });
    expect(await requestBrowserStoragePersistence({ persist: async () => undefined })).toMatchObject({ persistence: "unknown" });
    expect((await requestBrowserStoragePersistence({ persist: async () => true })).persistence).toBe("granted");
  });
  it("formats zero and estimated byte units without deriving guaranteed free space", () => {
    expect(formatEstimatedStorageBytes(null)).toBe("Sin información");
    expect(formatEstimatedStorageBytes(0)).toBe("0 B");
    expect(formatEstimatedStorageBytes(4096)).toBe("4 KiB");
    expect(formatEstimatedStorageBytes(1048576)).toBe("1 MiB");
    expect(formatEstimatedStorageBytes(1073741824)).toBe("1 GiB");
    expect(Object.values(BROWSER_PERSISTENCE_LABELS)).toEqual(["Concedida", "No concedida", "No disponible", "Desconocida"]);
  });
});
