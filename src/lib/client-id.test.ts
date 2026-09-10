import { describe, expect, it } from "vitest";

import {
  clientIdFromUrl,
  normalizeOpcoClientId,
  resolveEffectiveClientId,
} from "./client-id";

describe("client id resolution", () => {
  it("reads a valid clientId from an access link", () => {
    expect(clientIdFromUrl("https://client.opco.cl/?clientId=opco_app_abcdefghijklmnop")).toBe(
      "opco_app_abcdefghijklmnop",
    );
  });

  it("rejects empty or invalid clientId values", () => {
    expect(normalizeOpcoClientId("")).toBeNull();
    expect(normalizeOpcoClientId("not-an-opco-client")).toBeNull();
    expect(clientIdFromUrl("https://client.opco.cl/?clientId=")).toBeNull();
  });

  it("uses a persisted clientId when an access link does not provide one", () => {
    expect(resolveEffectiveClientId({
      fallbackClientId: "",
      persistedClientId: "opco_app_persisted1234567",
      urlClientId: null,
    })).toBe("opco_app_persisted1234567");
  });

  it("keeps the build-time fallback for compatible deployments", () => {
    expect(resolveEffectiveClientId({
      fallbackClientId: "opco_app_fallback12345678",
      persistedClientId: null,
      urlClientId: null,
    })).toBe("opco_app_fallback12345678");
  });

  it("lets a valid link replace a previous valid clientId", () => {
    expect(resolveEffectiveClientId({
      fallbackClientId: "opco_app_fallback12345678",
      persistedClientId: "opco_app_oldclient1234567",
      urlClientId: "opco_app_newclient1234567",
    })).toBe("opco_app_newclient1234567");
  });

  it("does not let an invalid link replace a valid persisted clientId", () => {
    expect(resolveEffectiveClientId({
      fallbackClientId: "",
      persistedClientId: "opco_app_persisted1234567",
      urlClientId: "invalid",
    })).toBe("opco_app_persisted1234567");
  });
});
