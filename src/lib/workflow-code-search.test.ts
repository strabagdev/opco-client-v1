import { expect, it } from "vitest";
import { codeSearchTextMatches } from "./workflow-code-search";

const rows = [
  ["a", "00.123.450-K"], ["b", "00.123.450-k"], ["c", "00123450K"],
  ["d", "PERSONA FICTICIA"], ["e", "Equipo_01%"], ["f", "EquipoX01X"], ["g", "Ñandú Ficticio"],
];
it.each([
  [" 00.123.450-k ", ["a", "b"]], ["00123450k", ["c"]], ["PERSONA", ["d"]],
  ["_01%", ["e"]], ["ñANDÚ", ["g"]], ["missing", []],
])("matches PostgreSQL's verified literal insensitive substring fixture for %s", (query, expected) => {
  expect(rows.filter(row => codeSearchTextMatches(row[1], query as string)).map(row => row[0])).toEqual(expected);
});
it("distinguishes a missing/invalid cached value from a known empty field", () => {
  expect(codeSearchTextMatches(null, "test")).toBe(false);
  expect(() => codeSearchTextMatches(undefined, "test")).toThrow();
  expect(() => codeSearchTextMatches(123, "test")).toThrow();
});
