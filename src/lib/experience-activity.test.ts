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

  it("tracks route bootstrap before the AppView renderer type is known", () => {
    activateExperienceActivityScope({
      appViewId: "view-attendance",
      appViewTitle: "Experiencia",
      appViewType: null,
      scopeKey: "scope-bootstrap",
    });
    report("scope-bootstrap", 1, null, null);

    expect(getExperienceActivitySnapshot()).toMatchObject({
      appViewId: "view-attendance",
      appViewType: null,
      result: "running",
    });
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
  it("rejects outgoing bootstrap cleanup and reports after renderer takeover of the same scope", () => {
    activateExperienceActivityScope({ appViewId: "view", appViewTitle: "Experiencia", appViewType: null, scopeKey: "scope", reporterId: "bootstrap" });
    activateExperienceActivityScope({ appViewId: "view", appViewTitle: "Asistencia", appViewType: "WORKFLOW", scopeKey: "scope", reporterId: "renderer" });
    reportExperienceActivity({ scopeKey: "scope", reporterId: "renderer", activeCount: 2, readCount: 2, readMode: "initial", errorCode: null, result: null });
    leaveExperienceActivityScope("scope", "bootstrap");
    reportExperienceActivity({ scopeKey: "scope", reporterId: "bootstrap", activeCount: 0, readCount: 0, errorCode: "LATE", result: "error" });
    expect(getExperienceActivitySnapshot()).toMatchObject({ appViewTitle: "Asistencia", readCount: 2, errorCode: null });
    reportExperienceActivity({ scopeKey: "scope", reporterId: "renderer", activeCount: 1, readCount: 1, errorCode: null, result: null });
    expect(getExperienceActivitySnapshot().activeRuns).toHaveLength(1);
    reportExperienceActivity({ scopeKey: "scope", reporterId: "renderer", activeCount: 0, readCount: 0, errorCode: null, result: "success" });
    expect(getExperienceActivitySnapshot()).toMatchObject({ activeRuns: [], readCount: 0, result: "success" });
  });
  it("does not accept late reads from a different owner/contract or cleared scope", () => {
    activate("owner-a:contract-a:view", "Primera");
    report("owner-a:contract-a:view", 2, null, null);
    activate("owner-b:contract-b:view", "Segunda");
    report("owner-a:contract-a:view", 0, "LATE", "error");
    expect(getExperienceActivitySnapshot()).toMatchObject({ appViewTitle: "Segunda", activeRuns: [], errorCode: null });
    leaveExperienceActivityScope("owner-b:contract-b:view");
    report("owner-b:contract-b:view", 1, null, null);
    expect(getExperienceActivitySnapshot().scopeKey).toBeNull();
  });

  it("does not hide a previous error on an optimistic success while a read remains active", () => {
    activate("scope-a", "Asistencia");
    report("scope-a", 0, "ATTENDANCE_REFRESH_FAILED", "error");
    reportExperienceActivity({ scopeKey: "scope-a", activeCount: 1, readCount: 1, errorCode: null, result: "success" });
    expect(getExperienceActivitySnapshot()).toMatchObject({ errorCode: "ATTENDANCE_REFRESH_FAILED", result: "running", readCount: 1 });
    reportExperienceActivity({ scopeKey: "scope-a", activeCount: 0, readCount: 0, errorCode: null, result: "success" });
    expect(getExperienceActivitySnapshot()).toMatchObject({ errorCode: null, activeRuns: [], result: "success" });
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
