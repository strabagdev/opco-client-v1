import { beforeEach, describe, expect, it, vi } from "vitest";

import { appViewIdFromPathname, clearWriteFeedback, getWriteFeedbackSnapshot, reportWriteFeedback, resetWriteFeedbackForTests, subscribeWriteFeedback, writeFeedbackScopeKey } from "./write-feedback";

describe("write feedback", () => {
  beforeEach(resetWriteFeedbackForTests);

  it("scopes a confirmed local save by user, contract, and experience", () => {
    reportWriteFeedback({ appViewId: "view-a", appViewTitle: "Personas", contractId: "contract-a", kind: "local-saved", ownerKey: "owner-a" });
    expect(getWriteFeedbackSnapshot()).toMatchObject({
      appViewId: "view-a",
      appViewTitle: "Personas",
      kind: "local-saved",
      scopeKey: writeFeedbackScopeKey("owner-a", "contract-a", "view-a"),
    });
  });

  it("resolves the visible experience from list, form, and detail routes", () => {
    expect(appViewIdFromPathname("/view/view-a")).toBe("view-a");
    expect(appViewIdFromPathname("/view/view%20a/record/new")).toBe("view a");
    expect(appViewIdFromPathname("/view/view-a/record/record-a/edit")).toBe("view-a");
    expect(appViewIdFromPathname("/")).toBeNull();
  });

  it("does not let an older timeout clear a consecutive save", () => {
    const scopeKey = writeFeedbackScopeKey("owner-a", "contract-a", "view-a");
    reportWriteFeedback({ appViewId: "view-a", appViewTitle: "Personas", contractId: "contract-a", kind: "local-saved", ownerKey: "owner-a" });
    const firstId = getWriteFeedbackSnapshot().id!;
    reportWriteFeedback({ appViewId: "view-a", appViewTitle: "Personas", contractId: "contract-a", kind: "local-saved", ownerKey: "owner-a" });
    const secondId = getWriteFeedbackSnapshot().id;
    clearWriteFeedback(firstId, scopeKey);
    expect(getWriteFeedbackSnapshot().id).toBe(secondId);
  });

  it("ignores clear callbacks from another scope", () => {
    reportWriteFeedback({ appViewId: "view-b", appViewTitle: "Protocolos", contractId: "contract-a", kind: "server-confirmed", ownerKey: "owner-a" });
    clearWriteFeedback(getWriteFeedbackSnapshot().id!, writeFeedbackScopeKey("owner-a", "contract-a", "view-a"));
    expect(getWriteFeedbackSnapshot()).toMatchObject({ appViewId: "view-b", kind: "server-confirmed" });
  });

  it("notifies only when a real confirmation or matching clear occurs", () => {
    const listener = vi.fn();
    subscribeWriteFeedback(listener);
    reportWriteFeedback({ appViewId: "view-a", appViewTitle: "Personas", contractId: "contract-a", kind: "local-saved", ownerKey: "owner-a" });
    clearWriteFeedback("stale-id", writeFeedbackScopeKey("owner-a", "contract-a", "view-a"));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
