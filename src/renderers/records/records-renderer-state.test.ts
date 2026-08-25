import { describe, expect, it } from "vitest";

import { resolveRecordsSearchForScopeChange } from "./records-renderer-state";

describe("records renderer state", () => {
  it("clears a residual search when navigation switches from Equipos to Personas", () => {
    expect(
      resolveRecordsSearchForScopeChange({
        currentSearch: {
          debouncedSearch: "EQ-",
          searchText: "EQ-",
        },
        nextScope: {
          appViewId: "view_personas",
          entityTypeId: "entity_personas",
        },
        previousScope: {
          appViewId: "view_equipos",
          entityTypeId: "entity_equipos",
        },
      }),
    ).toEqual({
      debouncedSearch: "",
      searchText: "",
    });
  });
});
