import { describe, expect, it } from "vitest";
import type { EntityDefinition, EntityField } from "./opco-api";
import { buildStateUpdateExtraForm, buildStateUpdateExtraSubmit, resolveStateUpdateSelectExtra, reviewStateUpdateMultipleSelection, unavailableStateUpdateExtraInput } from "./state-update-extras";

const field: EntityField = { id: "choice_id", key: "choice_key", name: "Opción", type: "SELECT", required: false, multiple: false,
  options: [{ id: "id_a", value: "A", label: "Alfa", active: true, order: 0 }, { id: "id_b", value: "B", label: "Beta", active: true, order: 0 }] };
const definition: EntityDefinition = { id: "entity", name: "Entidad", slug: "entity", active: true, icon: null, fields: [field] };

describe("STATE_UPDATE SELECT extras boundary", () => {
  it("reads canonical values by fieldId and submits field IDs, never the presentation key or optionId", () => {
    const form = buildStateUpdateExtraForm(definition, { choice_id: "A" }, "field-value");
    expect(form).toEqual({ values: { choice_key: "A" }, issues: {} });
    expect(buildStateUpdateExtraSubmit([field], form.values)).toEqual({ choice_id: "A" });
  });
  it("accepts historical key/value and unambiguous option IDs without modifying the source", () => {
    const old = { choice_key: "id_b" };
    expect(buildStateUpdateExtraForm(definition, old)).toEqual({ values: { choice_key: "B" }, issues: {} });
    expect(old).toEqual({ choice_key: "id_b" });
    expect(buildStateUpdateExtraForm(definition, { choice_key: "A" }).values.choice_key).toBe("A");
  });
  it("retains selections when old definitions have no options or the option is unknown", () => {
    for (const [f, raw] of [[{ ...field, options: undefined }, "id_a"], [field, "removed"]] as const) {
      const result = buildStateUpdateExtraForm({ ...definition, fields: [f] }, { choice_id: raw });
      expect(result.values.choice_key).toBe(raw);
      expect(result.issues.choice_key).toBeTruthy();
    }
  });
  it("does not reinterpret an ID that is another option's canonical value; new snapshots are explicit", () => {
    const f = { ...field, options: [...field.options!, { id: "other", value: "id_a", label: "Otra", active: true, order: 0 }] };
    const old = resolveStateUpdateSelectExtra(f, "id_a");
    expect(old.value).toBe("id_a"); expect(old.label).toBeNull(); expect(old.issue).toContain("ambigua");
    expect(unavailableStateUpdateExtraInput(f, old.value)).not.toBe("id_a");
    expect(resolveStateUpdateSelectExtra(f, "id_a", "field-value").label).toBe("Otra");
    expect(buildStateUpdateExtraForm({ ...definition, fields: [f] }, { choice_id: "id_a" }, "field-value").issues).toEqual({});
  });
  it("keeps inactive values readable and requires an explicit correction", () => {
    const f = { ...field, options: [{ ...field.options![0], active: false }] };
    const result = resolveStateUpdateSelectExtra(f, "A", "field-value");
    expect(result.label).toBe("Alfa"); expect(result.value).toBe("A"); expect(result.issue).toBeTruthy();
  });
  it("detects conflicting fieldId/key values and leaves an optional empty field empty", () => {
    expect(buildStateUpdateExtraForm(definition, { choice_id: "A", choice_key: "B" }).issues.choice_key).toContain("incompatibles");
    const empty = buildStateUpdateExtraForm(definition);
    expect(empty.values).toEqual({ choice_key: "" }); expect(empty.issues).toEqual({});
    expect(buildStateUpdateExtraSubmit([field], empty.values)).toEqual({ choice_id: null });
  });
});

describe("MULTISELECT extras", () => {
  const multi = { ...field, type: "MULTISELECT" as const };
  it("preserves all canonical selections and maps fieldId/key without reducing to one", () => {
    const stored = { choice_id: ["A", "B"] };
    const form = buildStateUpdateExtraForm({ ...definition, fields: [multi] }, stored, "field-value");
    expect(form).toEqual({ values: { choice_key: ["A", "B"] }, issues: {} });
    expect(buildStateUpdateExtraSubmit([multi], form.values)).toEqual(stored);
    expect(stored).toEqual({ choice_id: ["A", "B"] });
  });
  it("accepts unambiguous historical IDs, retains unavailable selections and reports malformed scalars", () => {
    const form = buildStateUpdateExtraForm({ ...definition, fields: [multi] }, { choice_key: ["id_a", "removed"] });
    expect(form.values.choice_key).toEqual(["A", "removed"]); expect(form.issues.choice_key).toBeTruthy();
    expect(buildStateUpdateExtraForm({ ...definition, fields: [multi] }, { choice_id: "A" }).issues.choice_key).toBeTruthy();
  });
  it("does not interpret a canonical value as an optionId in new arrays", () => {
    const ambiguous = { ...multi, options: [...multi.options!, { id: "other", value: "id_a", label: "Otra", active: true, order: 1 }] };
    expect(buildStateUpdateExtraForm({ ...definition, fields: [ambiguous] }, { choice_id: ["id_a"] }).issues.choice_key).toContain("ambigua");
    expect(buildStateUpdateExtraForm({ ...definition, fields: [ambiguous] }, { choice_id: ["id_a"] }, "field-value").values.choice_key).toEqual(["id_a"]);
  });
});

it("blocks a legacy missing relation catalog rather than treating its omitted value as a confirmed clear", () => {
  const relation: EntityField = { id: "rel", key: "rel_key", name: "Relación", type: "RELATION", required: false };
  const form = buildStateUpdateExtraForm({ ...definition, fields: [relation] });
  expect(form.values.rel_key).toBe(""); expect(form.issues.rel_key).toContain("definición");
});

it("keeps unreviewed multiple entries distinct from a colliding canonical option during explicit review", () => {
  const multi = { ...field, type: "MULTISELECT" as const, options: [...field.options!, { id: "other", value: "id_a", label: "Otra", active: true, order: 2 }] };
  const form = buildStateUpdateExtraForm({ ...definition, fields: [multi] }, { choice_id: ["id_a", "B"] });
  expect(form.unresolvedValues?.choice_key).toEqual(["id_a"]);
  const pending = unavailableStateUpdateExtraInput(multi, "id_a");
  expect(reviewStateUpdateMultipleSelection(multi, [pending, "B", "A"], ["id_a"])).toEqual({ values: ["id_a", "B", "A"], unresolved: ["id_a"] });
  expect(reviewStateUpdateMultipleSelection(multi, ["B", "A"], ["id_a"])).toEqual({ values: ["B", "A"], unresolved: [] });
  expect(reviewStateUpdateMultipleSelection(multi, [pending, "id_a"], ["id_a"]).unresolved).toEqual(["id_a"]);
  expect(reviewStateUpdateMultipleSelection(multi, ["id_a"], ["id_a"])).toEqual({ values: ["id_a"], unresolved: [] });
});
