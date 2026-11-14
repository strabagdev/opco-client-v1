import { describe, expect, it, vi } from "vitest";
import { createOpcoApi } from "./opco-api";
import { createManifestNegotiationRequest, validateManifestNegotiation, observeNegotiatedReceipts, getRevisionNegotiationDiagnostics, NEGOTIATION_VERSIONS } from "./revision-negotiation";

import {negotiationScope as scope,sampleNegotiation as sample} from "../test/revision-negotiation-fixture";
async function fixture() {
  const request = await createManifestNegotiationRequest(), raw = await sample(request);
  const manifest = await validateManifestNegotiation(raw, request, { contractId: "contract", ownerKey: "org:user" }, "synthetic-session");
  return { request, raw, manifest };
}
const latest = () => getRevisionNegotiationDiagnostics().at(-1);

describe("authenticated manifest v2 Client contract", () => {
  it("checks the complete actual Core shape including its MD5 tracking attestation", async () => {
    const { manifest } = await fixture(); expect(manifest.version).toBe(2); expect(latest()).toMatchObject({ code: "REVISION_NEGOTIATION_V2_MATCH", reuse: false, skipDownloads: false });
  });
  it.each(["nonce", "scope", "binding", "request", "version", "flags", "epoch", "definitions", "context", "incomplete", "snapshot", "content"])("rejects a response with incompatible %s", async change => {
    const { request, raw } = await fixture();
    if (change === "nonce") raw.negotiation.nonce = "event_of_another_request";
    if (change === "scope") raw.scope = { ...scope, userId: "other" };
    if (change === "binding") raw.negotiation.bindings.scopeFingerprint = "0".repeat(64);
    if (change === "request") raw.negotiation.requestFingerprint = "0".repeat(64);
    if (change === "version") raw.negotiation.supportedVersions = { ...NEGOTIATION_VERSIONS, receiptVersion: 2 } as unknown as typeof NEGOTIATION_VERSIONS;
    if (change === "flags") raw.negotiation.reuseAllowed = true;
    if (change === "epoch") raw.epoch = "new-epoch";
    if (change === "definitions") raw.readDefinitionsRevision = "0".repeat(64);
    if (change === "context") raw.context = { date: "2026-11-14", month: null };
    if (change === "incomplete") raw.tracking.dependenciesResolved = false;
    if (change === "snapshot") raw.snapshot.isolation = "read-committed";
    if (change === "content") raw.manifestRevision = "0".repeat(64);
    await expect(validateManifestNegotiation(raw, request, { contractId: "contract", ownerKey: "org:user" }, "synthetic-session")).rejects.toThrow();
  });
  it("rejects a response retired during hashing or a contract/app/auth mismatch", async () => {
    const { request, raw } = await fixture();
    for (const identity of [{ contractId: "other" }, { contractId: "contract", applicationId: "other" }, { contractId: "contract", authorizationFingerprint: "0".repeat(64) }]) await expect(validateManifestNegotiation(raw, request, identity, "synthetic")).rejects.toThrow("REVISION_SCOPE_MISMATCH");
    let checks = 0; await expect(validateManifestNegotiation(raw, request, { contractId: "contract" }, "synthetic", () => ++checks === 1)).rejects.toThrow("REVISION_SCOPE_RETIRED");
  });
  it("binds period, views and optional expectations to an independently generated nonce", async () => {
    const { manifest } = await fixture(), first = await createManifestNegotiationRequest({ month: "2026-11", appViewIds: ["b", "a"], expected: manifest }), second = await createManifestNegotiationRequest({ month: "2026-11", appViewIds: ["b", "a"], expected: manifest });
    expect(first.nonce).not.toBe(second.nonce); expect(first.appViewIds).toEqual(["a", "b"]);
    const raw = await sample(first); await validateManifestNegotiation(raw, first, { contractId: "contract" }, "synthetic");
    await expect(validateManifestNegotiation(raw, second, { contractId: "contract" }, "synthetic")).rejects.toThrow("REVISION_NEGOTIATION_NONCE_MISMATCH");
    const changed = await createManifestNegotiationRequest({ expected: { ...manifest, epoch: "old-epoch" } });
    await expect(validateManifestNegotiation(await sample(changed), changed, { contractId: "contract" }, "synthetic")).rejects.toThrow("REVISION_NEGOTIATION_REJECTED");
  });
  it("continues v1 only on explicit old-Core negotiation errors, without v2 accreditation", async () => {
    const { raw } = await fixture(); const legacy = { ...raw, version: 1 }; delete (legacy as Partial<typeof legacy>).negotiation;
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ok: false, error: { code: "INVALID_OFFLINE_MANIFEST_QUERY", message: "Unsupported" } }, { status: 400 })).mockResolvedValueOnce(Response.json({ ok: true, data: legacy }));
    const api = createOpcoApi({ apiUrl: "http://local.invalid", fetcher });
    expect((await api.getOfflineRevisionManifest("synthetic", "contract")).version).toBe(1); expect(fetcher).toHaveBeenCalledTimes(2); expect(latest()?.code).toBe("REVISION_NEGOTIATION_V1_ONLY");
  });
  it.each([403, 409, 503])("does not hide status %s with a v1 retry", async status => {
    const fetcher = vi.fn(async () => Response.json({ ok: false, error: { code: "UNAVAILABLE", message: "Synthetic" } }, { status }));
    await expect(createOpcoApi({ apiUrl: "http://local.invalid", fetcher }).getOfflineRevisionManifest("synthetic", "contract")).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("runtime-only storage observation without changing receipts", () => {
  const families = [["commitRevisionReceipt", "inspectRevisionReceipts"], ["commitPreparationRevisionReceipt", "inspectPreparationRevisionReceipts"], ["commitCatalogRevisionReceipt", "inspectCatalogRevisionReceipts"], ["commitRecordsRevisionReceipt", "inspectRecordsRevisionCoverage"], ["commitConsultationRevision", "inspectConsultationRevision"]];
  it.each(families)("links %s only after its real commit", async (commit, inspect) => {
    const { manifest } = await fixture(), handle = {}, context = { scope: { ...scope, ownerKey: "org:user" }, manifest, isCurrent: () => true };
    const receipt = { version: 1, mode: "shadow", reuseAllowed: false, snapshotId: crypto.randomUUID(), status: "verified", scope: context.scope, remote: { epoch: manifest.epoch }, coverage: { complete: true }, localHash: "local" };
    const observations = [{ status: "match_shadow", receipt }], original = { [commit]: vi.fn(async (_context: unknown) => receipt), [inspect]: vi.fn(async (_context: unknown) => observations) };
    const store = observeNegotiatedReceipts(original, async () => handle);
    expect(await store[inspect](context)).toBe(observations); expect(latest()?.code).toBe("REVISION_STORAGE_RUNTIME_UNACCREDITED");
    expect(await store[commit](context)).toBe(receipt); expect(latest()?.code).toBe("REVISION_RUNTIME_RECEIPT_ACCREDITED");
    expect(await store[inspect](context)).toBe(observations); expect(latest()).toMatchObject({ matched: 1, rejected: 0, reuse: false, skipDownloads: false });
    expect(original[commit]).toHaveBeenCalledWith(context);
  });
  it("rejects a replaced handle and a changed receipt while preserving the original return", async () => {
    const { manifest } = await fixture(); let handle = {};
    const context = { scope: { ...scope, ownerKey: "org:user" }, manifest, isCurrent: () => true }, receipt = { version: 1, mode: "shadow", reuseAllowed: false, snapshotId: crypto.randomUUID(), status: "verified", scope: context.scope, remote: { epoch: manifest.epoch }, coverage: { complete: true }, localHash: "before" };
    const store = observeNegotiatedReceipts({ async commitRevisionReceipt() { return receipt; }, async inspectRevisionReceipts() { return [{ status: "match_shadow", receipt }]; } }, async () => handle);
    await store.commitRevisionReceipt(); // Missing context does not accredit.
    const wrapped = store as unknown as { commitRevisionReceipt(c: typeof context): Promise<unknown>; inspectRevisionReceipts(c: typeof context): Promise<unknown> };
    await wrapped.commitRevisionReceipt(context); receipt.localHash = "changed"; await wrapped.inspectRevisionReceipts(context); expect(latest()?.rejected).toBe(1);
    receipt.localHash = "before"; handle = {}; await wrapped.inspectRevisionReceipts(context); expect(latest()?.rejected).toBe(1);
  });
  it("does not accredit an interrupted or retired commit", async () => {
    const { manifest } = await fixture(); let current = true;
    const store = observeNegotiatedReceipts({ async commitRevisionReceipt(_c: unknown) { current = false; return { snapshotId: "unchanged" }; } }, async () => ({}));
    const before = getRevisionNegotiationDiagnostics().length;
    expect(await store.commitRevisionReceipt({ manifest, isCurrent: () => current })).toEqual({ snapshotId: "unchanged" }); expect(getRevisionNegotiationDiagnostics()).toHaveLength(before);
    const failure = Error("Synthetic commit failure"); const failed = observeNegotiatedReceipts({ async commitRevisionReceipt(_c: unknown) { throw failure; } }, async () => ({}));
    await expect(failed.commitRevisionReceipt({ manifest, isCurrent: () => true })).rejects.toBe(failure);
  });
});
