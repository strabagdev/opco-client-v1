import { describe, expect, it, vi } from "vitest";

import {
  normalizeUniqueFieldValue,
  isUniqueValidationResultCurrent,
  validateUniqueFieldsBeforeSave,
  validateUniqueFieldsLocally,
  validateUniqueFieldsRemotely,
} from "./offline-unique-validation";
import { OpcoApiError, OpcoNetworkError, type EntityField } from "./opco-api";

function field(overrides: Partial<EntityField> = {}): EntityField {
  return {
    active: true,
    id: "field_rut",
    key: "rut",
    name: "RUT",
    order: 1,
    options: [],
    required: false,
    searchable: true,
    type: "TEXT",
    unique: true,
    ...overrides,
  };
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    displayName: "Empresa A",
    id: "server_1",
    localId: "local_1",
    remoteUpdatedAt: "2026-01-01T00:00:00.000Z",
    serverId: "server_1",
    syncStatus: "synced",
    updatedAt: "2026-01-01T00:00:00.000Z",
    values: { rut: "76.123.456-7" },
    ...overrides,
  } as never;
}

describe("offline unique validation", () => {
  it("finds a local conflict scoped to the same owner, contract and entity", async () => {
    const store = {
      listUniqueValidationRecords: vi.fn().mockResolvedValue([record()]),
    };

    const result = await validateUniqueFieldsLocally({
      contractId: "contract_1",
      entityTypeId: "entity_1",
      fields: [field()],
      ownerKey: "org_1:user_1",
      store,
      values: { rut: " 76.123.456-7 " },
    });

    expect(store.listUniqueValidationRecords).toHaveBeenCalledWith({
      contractId: "contract_1",
      entityTypeId: "entity_1",
      ownerKey: "org_1:user_1",
    });
    expect(result).toMatchObject({
      conflicts: [{
        conflictingLocalRecordId: "local_1",
        conflictingRecordId: "server_1",
        fieldKey: "rut",
        source: "local",
      }],
      status: "conflict",
    });
  });

  it("ignores the record being edited", async () => {
    const result = await validateUniqueFieldsLocally({
      contractId: "contract_1",
      entityTypeId: "entity_1",
      fields: [field()],
      ownerKey: "org_1:user_1",
      recordId: "server_1",
      store: {
        listUniqueValidationRecords: vi.fn().mockResolvedValue([record()]),
      },
      values: { rut: "76.123.456-7" },
    });

    expect(result).toEqual({ reason: "LOCAL_CACHE_PARTIAL", status: "inconclusive" });
  });

  it("does not warn when every unique value is empty", async () => {
    const result = await validateUniqueFieldsLocally({
      contractId: "contract_1",
      entityTypeId: "entity_1",
      fields: [field()],
      ownerKey: "org_1:user_1",
      store: {
        listUniqueValidationRecords: vi.fn().mockResolvedValue([record()]),
      },
      values: { rut: "" },
    });

    expect(result).toEqual({ status: "available" });
  });

  it("treats empty unique values as available and keeps zero and false as values", () => {
    expect(normalizeUniqueFieldValue(field(), "   ")).toEqual({ status: "empty" });
    expect(normalizeUniqueFieldValue(field({ type: "INTEGER" }), 0)).toEqual({
      displayValue: 0,
      key: "INTEGER:0",
      status: "value",
    });
    expect(normalizeUniqueFieldValue(field({ type: "BOOLEAN" }), false)).toEqual({
      displayValue: false,
      key: "BOOLEAN:false",
      status: "value",
    });
    expect(normalizeUniqueFieldValue(field({ type: "BOOLEAN" }), "false")).toEqual({
      displayValue: false,
      key: "BOOLEAN:false",
      status: "value",
    });
  });

  it("normalizes decimal, money, date, datetime and multiselect values", () => {
    expect(normalizeUniqueFieldValue(field({ type: "DECIMAL" }), "001.2300")).toMatchObject({
      displayValue: "1.23",
      key: "DECIMAL:1.23",
    });
    expect(normalizeUniqueFieldValue(field({ type: "MONEY" }), "000.00")).toMatchObject({
      displayValue: "0",
      key: "MONEY:0",
    });
    expect(normalizeUniqueFieldValue(field({ type: "DATE" }), "2026-09-14")).toMatchObject({
      displayValue: "2026-09-14",
      key: "DATE:2026-09-14",
    });
    expect(normalizeUniqueFieldValue(field({ type: "DATETIME" }), "2026-09-14T12:00:00-03:00")).toMatchObject({
      displayValue: "2026-09-14T15:00:00.000Z",
      key: "DATETIME:2026-09-14T15:00:00.000Z",
    });
    expect(normalizeUniqueFieldValue(field({ type: "MULTISELECT" }), ["a", "b", "a"])).toMatchObject({
      displayValue: ["a", "b"],
      key: "MULTISELECT:[\"a\",\"b\"]",
    });
  });

  it("uses the remote preflight without deriving availability from cached rows", async () => {
    const api = {
      validateUniqueEntityRecord: vi.fn().mockResolvedValue({
        available: false,
        conflicts: [{
          conflictingRecordId: "record_2",
          fieldId: "field_rut",
          fieldName: "RUT",
          message: "Ya existe un registro con este valor en \"RUT\".",
          rejectedValue: "76.123.456-7",
        }],
      }),
    };

    const result = await validateUniqueFieldsRemotely({
      api,
      contractId: "contract_1",
      entityTypeId: "entity_1",
      fields: [field()],
      token: "token",
      values: { rut: "76.123.456-7" },
    });

    expect(api.validateUniqueEntityRecord).toHaveBeenCalledWith("token", "contract_1", "entity_1", {
      fields: [{ fieldId: "field_rut", value: "76.123.456-7" }],
      recordId: undefined,
    });
    expect(result).toMatchObject({
      conflicts: [{ conflictingRecordId: "record_2", fieldKey: "rut", source: "remote" }],
      status: "conflict",
    });
  });

  it("does not block when the remote preflight fails because of connectivity", async () => {
    const result = await validateUniqueFieldsRemotely({
      api: {
        validateUniqueEntityRecord: vi.fn().mockRejectedValue(new OpcoNetworkError()),
      },
      contractId: "contract_1",
      entityTypeId: "entity_1",
      fields: [field()],
      token: "token",
      values: { rut: "76.123.456-7" },
    });

    expect(result).toEqual({ reason: "NETWORK_UNAVAILABLE", status: "inconclusive" });
  });

  it("keeps 404 rollout compatibility but does not silence auth or contractual errors", async () => {
    await expect(validateUniqueFieldsRemotely({
      api: {
        validateUniqueEntityRecord: vi.fn().mockRejectedValue(new OpcoApiError("No existe.", "NOT_FOUND", 404)),
      },
      contractId: "contract_1",
      entityTypeId: "entity_1",
      fields: [field()],
      token: "token",
      values: { rut: "76.123.456-7" },
    })).resolves.toEqual({ reason: "REMOTE_VALIDATION_FAILED", status: "inconclusive" });

    await expect(validateUniqueFieldsRemotely({
      api: {
        validateUniqueEntityRecord: vi.fn().mockRejectedValue(new OpcoApiError("No autorizado.", "FORBIDDEN", 403)),
      },
      contractId: "contract_1",
      entityTypeId: "entity_1",
      fields: [field()],
      token: "token",
      values: { rut: "76.123.456-7" },
    })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    await expect(validateUniqueFieldsRemotely({
      api: {
        validateUniqueEntityRecord: vi.fn().mockRejectedValue(new OpcoApiError("Campo invalido.", "INVALID_UNIQUE_VALIDATION_BODY", 400)),
      },
      contractId: "contract_1",
      entityTypeId: "entity_1",
      fields: [field()],
      token: "token",
      values: { rut: "76.123.456-7" },
    })).rejects.toMatchObject({ code: "INVALID_UNIQUE_VALIDATION_BODY", status: 400 });
  });

  it("maps legacy 409 unique responses to field conflicts", async () => {
    const result = await validateUniqueFieldsRemotely({
      api: {
        validateUniqueEntityRecord: vi.fn().mockRejectedValue(new OpcoApiError(
          "RUT debe ser unico.",
          "UNIQUE_FIELD_CONFLICT",
          409,
          {
            fields: [{
              fieldId: "field_rut",
              fieldLabel: "RUT",
              messages: ["RUT ya existe en otro registro."],
              rejectedValue: "76.123.456-7",
            }],
          },
        )),
      },
      contractId: "contract_1",
      entityTypeId: "entity_1",
      fields: [field()],
      token: "token",
      values: { rut: "76.123.456-7" },
    });

    expect(result).toMatchObject({
      conflicts: [{
        fieldKey: "rut",
        message: "RUT ya existe en otro registro.",
        source: "remote",
      }],
      status: "conflict",
    });
  });

  it("ignores stale blur results when the user already changed the value", () => {
    expect(isUniqueValidationResultCurrent("A", "A")).toBe(true);
    expect(isUniqueValidationResultCurrent("B", "A")).toBe(false);
    expect(isUniqueValidationResultCurrent(["a", "b"], ["a", "b"])).toBe(true);
    expect(isUniqueValidationResultCurrent(["b", "a"], ["a", "b"])).toBe(false);
  });

  it("blocks before save when the local cache finds a conflict and skips remote validation", async () => {
    const api = { validateUniqueEntityRecord: vi.fn() };
    const result = await validateUniqueFieldsBeforeSave({
      api,
      connectivityStatus: "online",
      contractId: "contract_1",
      entityTypeId: "entity_1",
      fields: [field()],
      ownerKey: "org_1:user_1",
      store: {
        listUniqueValidationRecords: vi.fn().mockResolvedValue([record()]),
      },
      token: "token",
      values: { rut: "76.123.456-7" },
    });

    expect(result.status).toBe("conflict");
    expect(api.validateUniqueEntityRecord).not.toHaveBeenCalled();
  });

  it("allows an offline save to proceed as inconclusive when no local conflict is known", async () => {
    const api = { validateUniqueEntityRecord: vi.fn() };
    const result = await validateUniqueFieldsBeforeSave({
      api,
      connectivityStatus: "offline",
      contractId: "contract_1",
      entityTypeId: "entity_1",
      fields: [field()],
      ownerKey: "org_1:user_1",
      store: {
        listUniqueValidationRecords: vi.fn().mockResolvedValue([]),
      },
      token: "token",
      values: { rut: "76.123.456-7" },
    });

    expect(result).toEqual({ reason: "LOCAL_CACHE_PARTIAL", status: "inconclusive" });
    expect(api.validateUniqueEntityRecord).not.toHaveBeenCalled();
  });
});
