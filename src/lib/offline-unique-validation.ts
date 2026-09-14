import type {
  CachedEntityRecord,
  OfflineRecordStore,
} from "./offline-records";
import type {
  EntityField,
  EntityRecordValue,
  OpcoApi,
  UniqueEntityRecordConflict,
} from "./opco-api";
import { OpcoApiError, OpcoNetworkError } from "./opco-api";

export type UniqueValidationConflict = {
  conflictingDisplayName?: string | null;
  conflictingLocalRecordId?: string | null;
  conflictingRecordId?: string | null;
  fieldId: string;
  fieldKey: string;
  fieldName: string;
  message: string;
  rejectedValue: EntityRecordValue | undefined;
  source: "local" | "remote";
};

export type UniqueValidationResult =
  | {
      conflicts: UniqueValidationConflict[];
      status: "conflict";
    }
  | {
      reason: "LOCAL_CACHE_PARTIAL" | "NETWORK_UNAVAILABLE" | "REMOTE_VALIDATION_FAILED";
      status: "inconclusive";
    }
  | {
      status: "available";
    };

export type NormalizedUniqueValue =
  | { displayValue: EntityRecordValue; key: string; status: "value" }
  | { status: "empty" }
  | { message: string; status: "invalid" };

type UniqueField = EntityField & { unique?: boolean };

export function isPreventiveUniqueFieldSupported(field: Pick<EntityField, "type">) {
  return field.type !== "RELATION" && field.type !== "FILE" && field.type !== "IMAGE";
}

export function getPreventiveUniqueFields(fields: EntityField[]) {
  return fields.filter((field): field is UniqueField => Boolean(field.unique) && isPreventiveUniqueFieldSupported(field));
}

export function isUniqueValidationResultCurrent(
  currentValue: EntityRecordValue | undefined,
  capturedValue: EntityRecordValue | undefined,
) {
  return JSON.stringify(currentValue) === JSON.stringify(capturedValue);
}

export async function validateUniqueFieldsLocally({
  contractId,
  entityTypeId,
  fields,
  ownerKey,
  recordId,
  serverRecordId,
  store,
  values,
}: {
  contractId: string;
  entityTypeId: string;
  fields: EntityField[];
  ownerKey: string;
  recordId?: string | null;
  serverRecordId?: string | null;
  store: Pick<OfflineRecordStore, "listUniqueValidationRecords">;
  values: Record<string, EntityRecordValue | undefined>;
}): Promise<UniqueValidationResult> {
  const uniqueFields = getPreventiveUniqueFields(fields)
    .filter((field) => Object.prototype.hasOwnProperty.call(values, field.key));

  if (uniqueFields.length === 0) {
    return { status: "available" };
  }

  const records = await store.listUniqueValidationRecords({ contractId, entityTypeId, ownerKey });
  const conflicts: UniqueValidationConflict[] = [];
  let checkedValueCount = 0;

  for (const field of uniqueFields) {
    const normalized = normalizeUniqueFieldValue(field, values[field.key]);

    if (normalized.status === "empty") {
      continue;
    }

    checkedValueCount += 1;

    if (normalized.status === "invalid") {
      conflicts.push({
        fieldId: field.id,
        fieldKey: field.key,
        fieldName: field.name,
        message: normalized.message,
        rejectedValue: values[field.key],
        source: "local",
      });
      continue;
    }

    const conflictingRecord = findLocalConflict({
      field,
      normalizedKey: normalized.key,
      recordId,
      serverRecordId,
      records,
    });

    if (conflictingRecord) {
      conflicts.push({
        conflictingDisplayName: conflictingRecord.displayName,
        conflictingLocalRecordId: conflictingRecord.localId,
        conflictingRecordId: conflictingRecord.serverId,
        fieldId: field.id,
        fieldKey: field.key,
        fieldName: field.name,
        message: `Ya existe un registro local con este valor en ${field.name}.`,
        rejectedValue: normalized.displayValue,
        source: "local",
      });
    }
  }

  if (conflicts.length > 0) {
    return { conflicts, status: "conflict" };
  }

  if (checkedValueCount === 0) {
    return { status: "available" };
  }

  return { reason: "LOCAL_CACHE_PARTIAL", status: "inconclusive" };
}

export async function validateUniqueFieldsBeforeSave({
  api,
  connectivityStatus,
  contractId,
  entityTypeId,
  fields,
  localRecordId,
  ownerKey,
  serverRecordId,
  store,
  token,
  values,
}: {
  api: Pick<OpcoApi, "validateUniqueEntityRecord">;
  connectivityStatus: "offline" | "online" | "unknown";
  contractId: string;
  entityTypeId: string;
  fields: EntityField[];
  localRecordId?: string | null;
  ownerKey: string;
  serverRecordId?: string | null;
  store: Pick<OfflineRecordStore, "listUniqueValidationRecords">;
  token: string;
  values: Record<string, EntityRecordValue | undefined>;
}): Promise<UniqueValidationResult> {
  const localResult = await validateUniqueFieldsLocally({
    contractId,
    entityTypeId,
    fields,
    ownerKey,
    recordId: localRecordId ?? serverRecordId ?? null,
    serverRecordId,
    store,
    values,
  });

  if (localResult.status === "conflict") {
    return localResult;
  }

  if (connectivityStatus !== "online") {
    return localResult;
  }

  const remoteResult = await validateUniqueFieldsRemotely({
    api,
    contractId,
    entityTypeId,
    fields,
    recordId: serverRecordId ?? null,
    token,
    values,
  });

  if (remoteResult.status === "conflict") {
    return remoteResult;
  }

  if (remoteResult.status === "available") {
    return remoteResult;
  }

  return localResult;
}

export async function validateUniqueFieldsRemotely({
  api,
  contractId,
  entityTypeId,
  fields,
  recordId,
  token,
  values,
}: {
  api: Pick<OpcoApi, "validateUniqueEntityRecord">;
  contractId: string;
  entityTypeId: string;
  fields: EntityField[];
  recordId?: string | null;
  token: string;
  values: Record<string, EntityRecordValue | undefined>;
}): Promise<UniqueValidationResult> {
  const uniqueFields = getPreventiveUniqueFields(fields)
    .filter((field) => Object.prototype.hasOwnProperty.call(values, field.key));

  if (uniqueFields.length === 0) {
    return { status: "available" };
  }

  const fieldsToValidate = uniqueFields.flatMap((field) => {
    const normalized = normalizeUniqueFieldValue(field, values[field.key]);

    if (normalized.status !== "value") {
      return [];
    }

    return [{ field, value: normalized.displayValue }];
  });

  if (fieldsToValidate.length === 0) {
    return { status: "available" };
  }

  try {
    const result = await api.validateUniqueEntityRecord(token, contractId, entityTypeId, {
      fields: fieldsToValidate.map(({ field, value }) => ({
        fieldId: field.id,
        value,
      })),
      recordId,
    });

    if (result.available) {
      return { status: "available" };
    }

    return {
      conflicts: result.conflicts.map((conflict) =>
        remoteConflictToLocalConflict(conflict, uniqueFields)
      ),
      status: "conflict",
    };
  } catch (error) {
    if (error instanceof OpcoNetworkError) {
      return { reason: "NETWORK_UNAVAILABLE", status: "inconclusive" };
    }

    if (error instanceof OpcoApiError) {
      if (error.code === "UNIQUE_FIELD_CONFLICT" || error.status === 409) {
        return opcoApiErrorToUniqueValidationResult(error, uniqueFields);
      }

      if (error.status === 404 || error.status >= 500) {
        return { reason: "REMOTE_VALIDATION_FAILED", status: "inconclusive" };
      }
    }

    throw error;
  }
}

export function normalizeUniqueFieldValue(
  field: EntityField,
  value: EntityRecordValue | undefined,
): NormalizedUniqueValue {
  if (value === undefined || value === null) {
    return { status: "empty" };
  }

  switch (field.type) {
    case "TEXT":
    case "TEXTAREA":
    case "PHONE":
    case "EMAIL":
    case "URL":
    case "SELECT":
    case "TIME": {
      const text = String(value).trim();

      if (!text) {
        return { status: "empty" };
      }

      if (field.type === "TIME" && !/^\d{2}:\d{2}$/.test(text)) {
        return { message: `${field.name} debe tener formato HH:mm.`, status: "invalid" };
      }

      return { displayValue: text, key: `${field.type}:${text}`, status: "value" };
    }
    case "INTEGER": {
      const integer = parseIntegerValue(value);

      if (integer === null) {
        return { status: "empty" };
      }

      if (!Number.isInteger(integer) || integer < -2147483648 || integer > 2147483647) {
        return { message: `${field.name} debe ser un entero valido.`, status: "invalid" };
      }

      return { displayValue: integer, key: `INTEGER:${integer}`, status: "value" };
    }
    case "DECIMAL":
    case "MONEY": {
      const decimal = normalizeDecimalValue(value);

      if (decimal === null) {
        return { status: "empty" };
      }

      if (!decimal) {
        return { message: `${field.name} debe ser un numero valido.`, status: "invalid" };
      }

      return { displayValue: decimal, key: `${field.type}:${decimal}`, status: "value" };
    }
    case "BOOLEAN":
      if (typeof value === "string" && !value.trim()) {
        return { status: "empty" };
      }

      {
        const booleanValue = value === true ||
          (typeof value === "string" && ["1", "on", "true"].includes(value.trim().toLowerCase()));

        return { displayValue: booleanValue, key: `BOOLEAN:${booleanValue}`, status: "value" };
      }
    case "DATE": {
      const date = normalizeDateOnlyValue(value);

      if (date === null) {
        return { status: "empty" };
      }

      if (!date) {
        return { message: `${field.name} debe tener formato YYYY-MM-DD.`, status: "invalid" };
      }

      return { displayValue: date, key: `DATE:${date}`, status: "value" };
    }
    case "DATETIME": {
      const datetime = normalizeDateTimeValue(value);

      if (datetime === null) {
        return { status: "empty" };
      }

      if (!datetime) {
        return { message: `${field.name} debe ser una fecha y hora valida.`, status: "invalid" };
      }

      return { displayValue: datetime, key: `DATETIME:${datetime}`, status: "value" };
    }
    case "MULTISELECT": {
      const items = Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
      const uniqueItems = Array.from(new Set(items));

      if (uniqueItems.length === 0) {
        return { status: "empty" };
      }

      return { displayValue: uniqueItems, key: `MULTISELECT:${JSON.stringify(uniqueItems)}`, status: "value" };
    }
    default:
      return { status: "empty" };
  }
}

function findLocalConflict({
  field,
  normalizedKey,
  recordId,
  serverRecordId,
  records,
}: {
  field: EntityField;
  normalizedKey: string;
  recordId?: string | null;
  serverRecordId?: string | null;
  records: CachedEntityRecord[];
}) {
  const ownRecordIds = new Set([recordId, serverRecordId].filter(Boolean));

  return records.find((record) => {
    if (ownRecordIds.has(record.localId) || ownRecordIds.has(record.serverId) || ownRecordIds.has(record.id)) {
      return false;
    }

    const candidate = normalizeUniqueFieldValue(field, record.values[field.key]);

    return candidate.status === "value" && candidate.key === normalizedKey;
  });
}

function remoteConflictToLocalConflict(
  conflict: UniqueEntityRecordConflict,
  fields: EntityField[],
): UniqueValidationConflict {
  const field = fields.find((item) => item.id === conflict.fieldId);

  return {
    conflictingRecordId: conflict.conflictingRecordId,
    fieldId: conflict.fieldId,
    fieldKey: field?.key ?? conflict.fieldId,
    fieldName: conflict.fieldName,
    message: conflict.message,
    rejectedValue: conflict.rejectedValue,
    source: "remote",
  };
}

function opcoApiErrorToUniqueValidationResult(
  error: OpcoApiError,
  fields: EntityField[],
): UniqueValidationResult {
  const details = error.details;
  const rawFields = details && typeof details === "object" && !Array.isArray(details) && "fields" in details
    ? (details as { fields?: unknown }).fields
    : null;

  if (!Array.isArray(rawFields)) {
    return { reason: "REMOTE_VALIDATION_FAILED", status: "inconclusive" };
  }

  const conflicts = rawFields.flatMap((item): UniqueValidationConflict[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }

    const raw = item as {
      fieldId?: unknown;
      fieldLabel?: unknown;
      messages?: unknown;
      rejectedValue?: EntityRecordValue;
    };
    const fieldId = typeof raw.fieldId === "string" ? raw.fieldId : "";
    const field = fields.find((candidate) => candidate.id === fieldId);

    if (!field) {
      return [];
    }

    const firstMessage = Array.isArray(raw.messages) && typeof raw.messages[0] === "string"
      ? raw.messages[0]
      : error.message;

    return [{
      fieldId,
      fieldKey: field.key,
      fieldName: typeof raw.fieldLabel === "string" ? raw.fieldLabel : field.name,
      message: firstMessage,
      rejectedValue: raw.rejectedValue,
      source: "remote",
    }];
  });

  return conflicts.length > 0
    ? { conflicts, status: "conflict" }
    : { reason: "REMOTE_VALIDATION_FAILED", status: "inconclusive" };
}

function parseIntegerValue(value: EntityRecordValue) {
  if (typeof value === "number") {
    return value;
  }

  const text = String(value).trim();

  if (!text) {
    return null;
  }

  if (!/^-?\d+$/.test(text)) {
    return Number.NaN;
  }

  return Number(text);
}

function normalizeDecimalValue(value: EntityRecordValue) {
  const text = String(value).trim();

  if (!text) {
    return null;
  }

  if (!/^-?\d+(?:\.\d+)?$/.test(text)) {
    return "";
  }

  const negative = text.startsWith("-");
  const [integerPart = "0", decimalPart = ""] = text.replace(/^-/, "").split(".");
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "") || "0";
  const normalizedDecimal = decimalPart.replace(/0+$/, "");
  const normalized = normalizedDecimal ? `${normalizedInteger}.${normalizedDecimal}` : normalizedInteger;

  return normalized === "0" ? "0" : `${negative ? "-" : ""}${normalized}`;
}

function normalizeDateOnlyValue(value: EntityRecordValue) {
  const text = String(value).trim();

  if (!text) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return "";
  }

  const date = new Date(`${text}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    return "";
  }

  return text;
}

function normalizeDateTimeValue(value: EntityRecordValue) {
  const text = String(value).trim();

  if (!text) {
    return null;
  }

  const date = new Date(text);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}
