import { config, trimTrailingSlash } from "./config";

export type ApiEnvelope<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: {
        code: string;
        details?: unknown;
        message: string;
      };
    };

export type LoginResponse = {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshToken?: string;
};

export type RefreshResponse = {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshToken?: string;
};

export type MeResponse = {
  app: {
    id: string;
    clientId: string;
    name: string;
    slug: string;
  };
  user: {
    id: string;
    email: string;
    name: string | null;
  };
};

export type Contract = {
  id: string;
  name: string;
  role: "ADMIN" | "MEMBER";
};

export type ContextResponse = {
  organization: {
    id: string;
    name: string;
  };
  contracts: Contract[];
};

export type EntitySummary = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  active: boolean;
};

export type AppViewType = "RECORDS" | "WORKFLOW" | "BOARD" | "DASHBOARD";

export type RecordsAppViewConfig = {
  entityTypeId: string;
};

export type AttendanceWorkflowConfig = {
  dateFieldId: string;
  observationFieldId?: string;
  personFieldId: string;
  sourceEntityTypeId: string;
  statusFieldId: string;
  targetEntityTypeId: string;
  workflowKey: "attendance";
};

export type StateUpdateWorkflowConfig = {
  dateFieldId?: string;
  extraFieldIds?: string[];
  historyMode?: StateUpdateHistoryMode;
  sourceEntityTypeId: string;
  stateFields?: {
    defaultOptionId?: string;
    fieldId: string;
    required?: boolean;
  }[];
  subjectFieldId: string;
  targetEntityTypeId: string;
  uniqueness?: StateUpdateUniqueness;
  workflowKey: "state-update";
};

export type WorkflowAppViewConfig =
  | AttendanceWorkflowConfig
  | StateUpdateWorkflowConfig
  | (Record<string, unknown> & { workflowKey?: string });
export type BoardAppViewConfig = Record<string, unknown>;
export type DashboardAppViewConfig = Record<string, unknown>;

export type RecordsAppView = {
  config: RecordsAppViewConfig;
  icon: string | null;
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  type: "RECORDS";
};

export type WorkflowAppView = {
  config: WorkflowAppViewConfig;
  icon: string | null;
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  type: "WORKFLOW";
};

export type BoardAppView = {
  config: BoardAppViewConfig;
  icon: string | null;
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  type: "BOARD";
};

export type DashboardAppView = {
  config: DashboardAppViewConfig;
  icon: string | null;
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  type: "DASHBOARD";
};

export type AppView = RecordsAppView | WorkflowAppView | BoardAppView | DashboardAppView;

export type EntityFieldType =
  | "BOOLEAN"
  | "DATE"
  | "DATETIME"
  | "DECIMAL"
  | "EMAIL"
  | "FILE"
  | "IMAGE"
  | "INTEGER"
  | "MONEY"
  | "MULTISELECT"
  | "PHONE"
  | "RELATION"
  | "SELECT"
  | "TEXT"
  | "TEXTAREA"
  | "TIME"
  | "URL";

export type EntityField = {
  id: string;
  key: string;
  name: string;
  type: EntityFieldType;
  required: boolean;
  unique?: boolean;
  searchable?: boolean;
  multiple?: boolean;
  active?: boolean;
  order?: number;
  config?: Record<string, unknown>;
  options?: {
    id: string;
    label: string;
    value: string;
    active: boolean;
    order: number;
  }[];
};

export type EntityDefinition = EntitySummary & {
  fields: EntityField[];
};

export type EntityRelationValue = {
  id: string;
  displayName: string;
  entityTypeId: string;
};

export type EntityRecordValue =
  | string
  | number
  | boolean
  | null
  | unknown[]
  | EntityRelationValue
  | EntityRelationValue[]
  | Record<string, unknown>;

export type EntityRecord = {
  id: string;
  displayName: string;
  updatedAt: string;
  values: Record<string, EntityRecordValue>;
};

export type EntityRecordPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type EntitiesResponse = {
  entities: EntitySummary[];
};

export type AppViewsResponse = {
  views: AppView[];
};

export type EntityDefinitionResponse = {
  entity: EntityDefinition;
};

export type EntityRecordsQuery = {
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  search?: string;
  sort?: "displayName" | "updatedAt" | `field:${string}`;
};

export type EntityRecordsResponse = {
  records: EntityRecord[];
  pagination: EntityRecordPagination;
};

export type EntityRecordResponse = {
  record: EntityRecord;
};

export type AttendanceWorkflowQuery = {
  date: string;
  personRecordId?: string;
  search?: string;
};

export type AttendanceStatusOption = {
  isDefaultCheckIn: boolean;
  label: string;
  optionId: string;
};

export type AttendanceItem = {
  attendance: {
    observation: string | null;
    recordId: string;
    statusLabel: string | null;
    statusOptionId: string | null;
    updatedAt: string;
  } | null;
  person: {
    displayName: string;
    id: string;
  };
};

export type AttendanceLatestItem = {
  attendanceRecordId: string;
  person: {
    displayName: string;
    id: string;
  };
  statusLabel: string | null;
  statusOptionId: string | null;
  updatedAt?: string;
};

export type AttendanceResponse = {
  appView: {
    id: string;
    name: string;
    slug: string;
  };
  date: string;
  items: AttendanceItem[];
  latest: AttendanceLatestItem[];
  sourceEntityType: {
    id: string;
    name: string;
  };
  statuses: AttendanceStatusOption[];
  summary: {
    totalRegistered: number;
  };
  targetEntityType: {
    id: string;
    name: string;
  };
};

export type AttendanceBatchEntry = {
  expectedUpdatedAt?: string;
  observation?: string | null;
  overwrite?: boolean;
  personRecordId: string;
  statusOptionId: string;
};

export type AttendanceBatchRequest = {
  clientRequestId?: string;
  date: string;
  entries: AttendanceBatchEntry[];
};

export type AttendanceBatchResult =
  | {
      personRecordId: string;
      recordId: string;
      result: "CREATED" | "UNCHANGED" | "UPDATED";
    }
  | {
      existing: {
        recordId: string;
        statusLabel: string | null;
        statusOptionId: string | null;
        updatedAt: string;
      };
      personRecordId: string;
      requested: {
        statusLabel: string;
        statusOptionId: string;
      };
      result: "CONFLICT";
    }
  | {
      code: string;
      message: string;
      personRecordId: string;
      result: "ERROR";
    };

export type AttendanceBatchResponse = {
  appView: {
    id: string;
    name: string;
    slug: string;
  };
  date: string;
  results: AttendanceBatchResult[];
};

export type StateUpdateUniqueness = "none" | "subject" | "subject-date";
export type StateUpdateHistoryMode = "append" | "update-current";

export type StateUpdateWorkflowQuery = {
  date?: string;
  search?: string;
  subjectRecordId?: string;
};

export type StateUpdateOption = {
  active?: boolean;
  id?: string;
  label: string;
  optionId: string;
  order?: number;
};

export type StateUpdateField = {
  defaultOptionId?: string;
  fieldId: string;
  key?: string;
  label: string;
  name?: string;
  options: StateUpdateOption[];
  required: boolean;
};

export type StateUpdateSubject = {
  displayName: string;
  id: string;
};

export type StateUpdateCurrentFieldValue = {
  fieldId: string;
  label: string | null;
  optionId: string | null;
};

export type StateUpdateCurrent = {
  extraValues?: Record<string, EntityRecordValue>;
  recordId: string;
  stateValues: StateUpdateCurrentFieldValue[];
  updatedAt: string;
} | null;

export type StateUpdateItem = {
  current: StateUpdateCurrent;
  subject: StateUpdateSubject;
};

export type StateUpdateLatestItem = {
  recordId: string;
  stateValues?: StateUpdateCurrentFieldValue[];
  subject: StateUpdateSubject;
  updatedAt?: string;
};

export type StateUpdateSummary = {
  totalRegistered?: number;
  [key: string]: unknown;
};

export type StateUpdateResponse = {
  appView: {
    id: string;
    name: string;
    slug: string;
  };
  date?: string;
  dateFieldId?: string;
  extraFields: EntityField[];
  historyMode: StateUpdateHistoryMode;
  items: StateUpdateItem[];
  latest?: StateUpdateLatestItem[];
  sourceEntityType: {
    id: string;
    name: string;
  };
  stateFields: StateUpdateField[];
  subjectFieldId: string;
  summary?: StateUpdateSummary;
  targetEntityType: {
    id: string;
    name: string;
  };
  uniqueness: StateUpdateUniqueness;
};

export type StateUpdateEntry = {
  expectedUpdatedAt?: string;
  extraValues?: Record<string, EntityRecordValue>;
  overwrite?: boolean;
  stateValues: {
    fieldId: string;
    optionId: string | null;
  }[];
  subjectRecordId: string;
};

export type StateUpdateRequest = {
  clientRequestId?: string;
  date?: string;
  entries: StateUpdateEntry[];
};

export type StateUpdateBatchResult =
  | {
      recordId: string;
      result: "CREATED" | "UNCHANGED" | "UPDATED";
      subjectRecordId: string;
    }
  | {
      existing: {
        recordId: string;
        stateValues: StateUpdateCurrentFieldValue[];
        updatedAt: string;
      };
      requested: {
        stateValues: StateUpdateCurrentFieldValue[];
      };
      result: "CONFLICT";
      subjectRecordId: string;
    }
  | {
      code: string;
      message: string;
      result: "ERROR";
      subjectRecordId: string;
    };

export type StateUpdateBatchResponse = {
  appView: {
    id: string;
    name: string;
    slug: string;
  };
  date?: string;
  results: StateUpdateBatchResult[];
};

export type CreateEntityRecordInput = {
  clientRequestId: string;
  values: Record<string, EntityRecordValue>;
};

export type UpdateEntityRecordInput = {
  values: Record<string, EntityRecordValue>;
};

export class OpcoApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "OpcoApiError";
  }
}

export class OpcoNetworkError extends Error {
  constructor(message = "No fue posible conectar con Opco.") {
    super(message);
    this.name = "OpcoNetworkError";
  }
}

type FetchLike = typeof fetch;

type ApiClientOptions = {
  apiUrl?: string;
  clientId?: string;
  fetcher?: FetchLike;
  onSessionInvalid?: () => void;
  onSessionRefreshed?: (tokens: RefreshResponse) => void;
  platformOS?: PlatformOS;
  tokenStore?: SessionTokenStore;
  timeoutMs?: number;
};

type PlatformOS = "web" | "ios" | "android" | "macos" | "windows" | string;

const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;
const NATIVE_CLIENT_PLATFORM_HEADER = "native";
const TOKEN_EXPIRED_CODE = "TOKEN_EXPIRED";
const TOKEN_INVALID_CODE = "TOKEN_INVALID";
const INVALID_REFRESH_CODES = new Set([
  "REFRESH_TOKEN_EXPIRED",
  "REFRESH_TOKEN_REVOKED",
  "REFRESH_TOKEN_REUSED",
  "REFRESH_USER_INACTIVE",
  "REFRESH_APP_INACTIVE",
]);

type SessionTokenStore = {
  clearSession(): Promise<void>;
  getRefreshToken(): Promise<string | null>;
  setSession(tokens: { accessToken: string; refreshToken?: string | null }): Promise<void>;
};

export function parseApiEnvelope<T>(body: unknown, status = 200): T {
  if (!isApiEnvelope<T>(body)) {
    throw new OpcoApiError("Respuesta inesperada de Opco.", "INVALID_API_ENVELOPE", status);
  }

  if (!body.ok) {
    throw new OpcoApiError(body.error.message, body.error.code, status, body.error.details);
  }

  return body.data;
}

export function createOpcoApi(options: ApiClientOptions = {}) {
  const apiUrl = trimTrailingSlash(options.apiUrl ?? config.apiUrl);
  const clientId = options.clientId ?? config.clientId;
  const fetcher = options.fetcher ?? fetch;
  const platformOS = options.platformOS ?? getDefaultPlatformOS();
  const tokenStore = options.tokenStore;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  let refreshPromise: Promise<RefreshResponse> | null = null;

  async function request<T>(path: string, init: RequestInit = {}) {
    let response: Response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      response = await fetcher(`${apiUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new OpcoNetworkError("La solicitud a Opco agoto el tiempo de espera.");
      }

      throw new OpcoNetworkError();
    } finally {
      clearTimeout(timeoutId);
    }

    const body = await response.json().catch(() => null);

    return parseApiEnvelope<T>(body, response.status);
  }

  async function authenticatedRequest<T>(path: string, token: string, init: RequestInit = {}) {
    try {
      return await request<T>(path, withAuthHeaders(init, token));
    } catch (error) {
      if (!shouldRefresh(error)) {
        await clearInvalidSession(error);
        throw error;
      }
    }

    const refreshed = await refreshSession();

    try {
      return await request<T>(path, withAuthHeaders(init, refreshed.accessToken));
    } catch (error) {
      await clearInvalidSession(error);
      throw error;
    }
  }

  async function refreshSession() {
    if (!refreshPromise) {
      refreshPromise = performRefresh()
        .then(async (tokens) => {
          await tokenStore?.setSession(tokens);
          options.onSessionRefreshed?.(tokens);
          return tokens;
        })
        .catch(async (error) => {
          if (isInvalidRefreshError(error)) {
            await tokenStore?.clearSession();
            options.onSessionInvalid?.();
          }

          throw error;
        })
        .finally(() => {
          refreshPromise = null;
        });
    }

    return refreshPromise;
  }

  async function performRefresh() {
    if (platformOS === "web") {
      return request<RefreshResponse>("/api/v1/auth/refresh", {
        credentials: "include",
        method: "POST",
      });
    }

    const refreshToken = await tokenStore?.getRefreshToken();

    if (!refreshToken) {
      throw new OpcoApiError("La sesion local no tiene refresh token.", "REFRESH_TOKEN_MISSING", 401);
    }

    return request<RefreshResponse>("/api/v1/auth/refresh", {
      body: JSON.stringify({ refreshToken }),
      headers: nativePlatformHeaders(),
      method: "POST",
    });
  }

  function authHeaders(token: string) {
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  function withAuthHeaders(init: RequestInit, token: string): RequestInit {
    return {
      ...init,
      headers: {
        ...authHeaders(token),
        ...init.headers,
      },
    };
  }

  function nativePlatformHeaders(): Record<string, string> {
    if (platformOS === "web") {
      return {};
    }

    return {
      "X-Opco-Client-Platform": NATIVE_CLIENT_PLATFORM_HEADER,
    };
  }

  async function clearInvalidSession(error: unknown) {
    if (error instanceof OpcoApiError && error.status === 401 && error.code === TOKEN_INVALID_CODE) {
      await tokenStore?.clearSession();
      options.onSessionInvalid?.();
    }
  }

  return {
    refreshSession,
    login(email: string, password: string) {
      return request<LoginResponse>("/api/v1/auth/login", {
        body: JSON.stringify({
          email,
          password,
          clientId,
        }),
        credentials: platformOS === "web" ? "include" : undefined,
        headers: nativePlatformHeaders(),
        method: "POST",
      });
    },
    logout(refreshToken?: string | null) {
      return request<void>("/api/v1/auth/logout", {
        body: platformOS === "web" || !refreshToken ? undefined : JSON.stringify({ refreshToken }),
        credentials: platformOS === "web" ? "include" : undefined,
        headers: nativePlatformHeaders(),
        method: "POST",
      });
    },
    getMe(token: string) {
      return authenticatedRequest<MeResponse>("/api/v1/me", token);
    },
    getContext(token: string) {
      return authenticatedRequest<ContextResponse>("/api/v1/context", token);
    },
    getEntities(token: string, contractId: string) {
      return authenticatedRequest<EntitiesResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/entities`,
        token,
      );
    },
    getAppViews(token: string, contractId: string) {
      return authenticatedRequest<AppViewsResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/views`,
        token,
      );
    },
    getEntityDefinition(token: string, contractId: string, entityTypeId: string) {
      return authenticatedRequest<EntityDefinitionResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/entities/${encodeURIComponent(entityTypeId)}`,
        token,
      );
    },
    getEntityRecords(
      token: string,
      contractId: string,
      entityTypeId: string,
      query: EntityRecordsQuery = {},
    ) {
      const searchParams = new URLSearchParams();

      if (query.page !== undefined) {
        searchParams.set("page", String(query.page));
      }

      if (query.pageSize !== undefined) {
        searchParams.set("pageSize", String(query.pageSize));
      }

      if (query.search?.trim()) {
        searchParams.set("search", query.search.trim());
      }

      if (query.sort) {
        searchParams.set("sort", query.sort);
      }

      if (query.direction) {
        searchParams.set("direction", query.direction);
      }

      const serializedQuery = searchParams.toString();

      return authenticatedRequest<EntityRecordsResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/entities/${encodeURIComponent(entityTypeId)}/records${
          serializedQuery ? `?${serializedQuery}` : ""
        }`,
        token,
      ).then(normalizeEntityRecordsResponse);
    },
    getEntityRecord(token: string, contractId: string, entityTypeId: string, recordId: string) {
      return authenticatedRequest<EntityRecordResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/entities/${encodeURIComponent(
          entityTypeId,
        )}/records/${encodeURIComponent(recordId)}`,
        token,
      ).then(normalizeEntityRecordResponse);
    },
    createEntityRecord(token: string, contractId: string, entityTypeId: string, input: CreateEntityRecordInput) {
      return authenticatedRequest<EntityRecordResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/entities/${encodeURIComponent(entityTypeId)}/records`,
        token,
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      ).then(normalizeEntityRecordResponse);
    },
    updateEntityRecord(
      token: string,
      contractId: string,
      entityTypeId: string,
      recordId: string,
      input: UpdateEntityRecordInput,
    ) {
      return authenticatedRequest<EntityRecordResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/entities/${encodeURIComponent(
          entityTypeId,
        )}/records/${encodeURIComponent(recordId)}`,
        token,
        {
          body: JSON.stringify(input),
          method: "PATCH",
        },
      ).then(normalizeEntityRecordResponse);
    },
    getAttendanceWorkflow(
      token: string,
      contractId: string,
      appViewId: string,
      query: string | AttendanceWorkflowQuery,
    ) {
      const normalizedQuery = typeof query === "string" ? { date: query } : query;
      const searchParams = new URLSearchParams({ date: normalizedQuery.date });

      if (normalizedQuery.search?.trim()) {
        searchParams.set("search", normalizedQuery.search.trim());
      }

      if (normalizedQuery.personRecordId?.trim()) {
        searchParams.set("personRecordId", normalizedQuery.personRecordId.trim());
      }

      return authenticatedRequest<AttendanceResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/views/${encodeURIComponent(
          appViewId,
        )}/workflow/attendance?${searchParams.toString()}`,
        token,
      ).then(normalizeAttendanceResponse);
    },
    getStateUpdateWorkflow(
      token: string,
      contractId: string,
      appViewId: string,
      query: StateUpdateWorkflowQuery = {},
    ) {
      const searchParams = new URLSearchParams();

      if (query.date?.trim()) {
        searchParams.set("date", query.date.trim());
      }

      if (query.search?.trim()) {
        searchParams.set("search", query.search.trim());
      }

      if (query.subjectRecordId?.trim()) {
        searchParams.set("subjectRecordId", query.subjectRecordId.trim());
      }

      const serializedQuery = searchParams.toString();

      return authenticatedRequest<StateUpdateResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/views/${encodeURIComponent(
          appViewId,
        )}/workflow/state-update${serializedQuery ? `?${serializedQuery}` : ""}`,
        token,
      ).then(normalizeStateUpdateResponse);
    },
    saveAttendanceWorkflow(
      token: string,
      contractId: string,
      appViewId: string,
      input: AttendanceBatchRequest,
    ) {
      return authenticatedRequest<AttendanceBatchResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/views/${encodeURIComponent(appViewId)}/workflow/attendance`,
        token,
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      ).then(normalizeAttendanceBatchResponse);
    },
    saveStateUpdateWorkflow(
      token: string,
      contractId: string,
      appViewId: string,
      input: StateUpdateRequest,
    ) {
      return authenticatedRequest<StateUpdateBatchResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/views/${encodeURIComponent(appViewId)}/workflow/state-update`,
        token,
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      ).then(normalizeStateUpdateBatchResponse);
    },
  };
}

function normalizeEntityRecordsResponse(response: EntityRecordsResponse): EntityRecordsResponse {
  return {
    ...response,
    records: response.records.map(normalizeEntityRecord),
  };
}

function normalizeEntityRecordResponse(response: EntityRecordResponse): EntityRecordResponse {
  return {
    ...response,
    record: normalizeEntityRecord(response.record),
  };
}

function normalizeAttendanceResponse(response: AttendanceResponse): AttendanceResponse {
  response.latest.forEach((item) => {
    if (item.updatedAt) {
      assertIsoDateTime(item.updatedAt, "Opco devolvio un updatedAt invalido para el ultimo registro de asistencia.");
    }
  });

  return {
    ...response,
    items: response.items.map((item) => {
      if (item.attendance) {
        assertIsoDateTime(item.attendance.updatedAt, "Opco devolvio un updatedAt invalido para la asistencia.");
      }

      return item;
    }),
  };
}

function normalizeAttendanceBatchResponse(response: AttendanceBatchResponse): AttendanceBatchResponse {
  response.results.forEach((result) => {
    if (result.result === "CONFLICT") {
      assertIsoDateTime(result.existing.updatedAt, "Opco devolvio un updatedAt invalido para el conflicto de asistencia.");
    }
  });

  return response;
}

function normalizeStateUpdateResponse(response: StateUpdateResponse): StateUpdateResponse {
  response.latest?.forEach((item) => {
    if (item.updatedAt) {
      assertIsoDateTime(item.updatedAt, "Opco devolvio un updatedAt invalido para el ultimo cambio de estado.");
    }
  });

  response.items.forEach((item) => {
    if (item.current) {
      assertIsoDateTime(item.current.updatedAt, "Opco devolvio un updatedAt invalido para el estado actual.");
    }
  });

  return response;
}

function normalizeStateUpdateBatchResponse(response: StateUpdateBatchResponse): StateUpdateBatchResponse {
  response.results.forEach((result) => {
    if (result.result === "CONFLICT") {
      assertIsoDateTime(result.existing.updatedAt, "Opco devolvio un updatedAt invalido para el conflicto de estado.");
    }
  });

  return response;
}

function normalizeEntityRecord(record: EntityRecord): EntityRecord {
  assertIsoDateTime(record.updatedAt, "Opco devolvio un updatedAt invalido para el registro.");

  return record;
}

function assertIsoDateTime(value: unknown, message: string) {
  if (!isIsoDateTime(value)) {
    throw new OpcoApiError(message, "INVALID_RECORD_UPDATED_AT", 200);
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export type OpcoApi = ReturnType<typeof createOpcoApi>;

function getDefaultPlatformOS(): PlatformOS {
  return typeof window === "undefined" ? "ios" : "web";
}

function shouldRefresh(error: unknown) {
  return error instanceof OpcoApiError && error.status === 401 && error.code === TOKEN_EXPIRED_CODE;
}

function isInvalidRefreshError(error: unknown) {
  return (
    error instanceof OpcoApiError &&
    error.status === 401 &&
    (INVALID_REFRESH_CODES.has(error.code) || error.code === TOKEN_INVALID_CODE || error.code === "REFRESH_TOKEN_MISSING")
  );
}

function isIsoDateTime(value: unknown) {
  if (typeof value !== "string") {
    return false;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isApiEnvelope<T>(body: unknown): body is ApiEnvelope<T> {
  if (!body || typeof body !== "object" || !("ok" in body)) {
    return false;
  }

  const envelope = body as ApiEnvelope<T>;

  if (envelope.ok === true) {
    return "data" in envelope;
  }

  return (
    envelope.ok === false &&
    Boolean(envelope.error) &&
    typeof envelope.error.code === "string" &&
    typeof envelope.error.message === "string"
  );
}
