import { describe, expect, it } from "vitest";

import { createStateUpdateLocalRecordId } from "./state-update-offline";

describe("state-update offline identity", () => {
  it("consolidates update-current by appView, subject, and date when uniqueness is subject-date", () => {
    const first = createStateUpdateLocalRecordId({
      appViewId: "view_equipment_state",
      date: "2026-08-25",
      historyMode: "update-current",
      subjectRecordId: "equipment_1",
      uniqueness: "subject-date",
    });
    const second = createStateUpdateLocalRecordId({
      appViewId: "view_equipment_state",
      date: "2026-08-25",
      historyMode: "update-current",
      subjectRecordId: "equipment_1",
      uniqueness: "subject-date",
    });

    expect(second).toBe(first);
  });

  it("does not consolidate append events for the same subject and date", () => {
    const first = createStateUpdateLocalRecordId({
      appViewId: "view_equipment_state",
      date: "2026-08-25",
      historyMode: "append",
      subjectRecordId: "equipment_1",
      uniqueness: "subject-date",
    });
    const second = createStateUpdateLocalRecordId({
      appViewId: "view_equipment_state",
      date: "2026-08-25",
      historyMode: "append",
      subjectRecordId: "equipment_1",
      uniqueness: "subject-date",
    });

    expect(second).not.toBe(first);
  });
});
