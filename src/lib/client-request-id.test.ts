import { describe, expect, it } from "vitest";

import { createClientRequestId } from "./client-request-id";

describe("createClientRequestId", () => {
  it("generates UUID-compatible request ids", () => {
    expect(createClientRequestId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
