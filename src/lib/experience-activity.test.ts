import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activateExperienceActivityScope,
  getExperienceActivitySnapshot,
  leaveExperienceActivityScope,
  reportExperienceActivity,
  resetExperienceActivityForTests,
  subscribeExperienceActivity,
} from "./experience-activity";

describe("visible experience activity", () => {
  beforeEach(() => resetExperienceActivityForTests());

  it("tracks concurrent reads without becoming idle until all relevant work finishes", () => {
    activate("scope-a", "Protocolos");
    report("scope-a", 2, null, null);
    expect(getExperienceActivitySnapshot().activeRuns).toHaveLength(2);

    report("scope-a", 1, null, null);
    expect(getExperienceActivitySnapshot()).toMatchObject({ result: "running" });
    expect(getExperienceActivitySnapshot().activeRuns).toHaveLength(1);

    report("scope-a", 0, null, "success");
    expect(getExperienceActivitySnapshot()).toMatchObject({ activeRuns: [], result: "success" });
  });

  it("retains a failed refresh until a later successful refresh recovers it", () => {
    activate("scope-a", "Protocolos");
    report("scope-a", 0, "RECORDS_READ_FAILED", "error");
    expect(getExperienceActivitySnapshot()).toMatchObject({ errorCode: "RECORDS_READ_FAILED", result: "error" });

    report("scope-a", 1, null, null);
    expect(getExperienceActivitySnapshot().errorCode).toBe("RECORDS_READ_FAILED");
    report("scope-a", 0, null, "success");
    expect(getExperienceActivitySnapshot()).toMatchObject({ errorCode: null, result: "success" });
  });

  it("ignores late updates from a previous experience scope", () => {
    activate("scope-a", "Protocolos");
    report("scope-a", 1, null, null);
    activate("scope-b", "Personas");
    report("scope-a", 0, "LATE_FAILURE", "error");

    expect(getExperienceActivitySnapshot()).toMatchObject({
      appViewTitle: "Personas",
      errorCode: null,
      scopeKey: "scope-b",
    });
  });

  it("clears only the currently visible scope and emits transitions, not render ticks", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeExperienceActivity(listener);
    activate("scope-a", "Protocolos");
    report("scope-a", 1, null, null);
    report("scope-a", 1, null, null);
    leaveExperienceActivityScope("scope-b");
    expect(listener).toHaveBeenCalledTimes(2);

    leaveExperienceActivityScope("scope-a");
    expect(getExperienceActivitySnapshot().scopeKey).toBeNull();
    unsubscribe();
  });
});

function activate(scopeKey: string, appViewTitle: string) {
  activateExperienceActivityScope({
    appViewId: `view-${scopeKey}`,
    appViewTitle,
    appViewType: "RECORDS",
    scopeKey,
  });
}

function report(
  scopeKey: string,
  activeCount: number,
  errorCode: string | null,
  result: "success" | "partial" | "error" | "cancelled" | null,
) {
  reportExperienceActivity({ activeCount, errorCode, result, scopeKey });
}
