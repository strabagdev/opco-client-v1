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
  defaultCheckInOptionId?: string;
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
  updatedAt: string;
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
  updatedAt: string;
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

export type StateUpdateRequest = StateUpdateEntry & {
  clientRequestId?: string;
  date?: string;
};

export type StateUpdateBatchResult =
  | {
      recordId: string;
      result: "CREATED" | "UNCHANGED" | "UPDATED";
      subjectRecordId: string;
      updatedAt: string;
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

type StateUpdateApiConflictResult = {
  differences: {
    existingLabel: string | null;
    existingOptionId: string | null;
    fieldId: string;
    requestedLabel: string;
    requestedOptionId: string;
  }[];
  existing: {
    recordId: string;
    updatedAt: string;
  };
  requested: {
    states: Record<string, string>;
  };
  result: "CONFLICT";
  subjectRecordId: string;
};

type StateUpdateApiResult =
  | Extract<StateUpdateBatchResult, { result: "CREATED" | "ERROR" | "UNCHANGED" | "UPDATED" }>
  | StateUpdateApiConflictResult;

type StateUpdateApiResponse = Omit<StateUpdateBatchResponse, "results"> & {
  result?: StateUpdateApiResult;
  results?: StateUpdateApiResult[];
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
    public readonly diagnosticRequestId?: string | null,
  ) {
    super(message);
    this.name = "OpcoApiError";
  }
}

export type OpcoNetworkDiagnostics = {
  abortControllerTriggered: boolean;
  attemptNumber?: number | null;
  diagnosticOperation?: OpcoDiagnosticRequestOperation;
  diagnosticRequestId?: string;
  diagnosticSyncRunId?: string | null;
  errorCode?: string | null;
  fetchResolvedAt: string | null;
  httpStatus: number | null;
  method: string;
  pathTemplate: string;
  requestCompletedAt: string;
  requestDurationMs: number;
  requestStartedAt: string;
  responseBodyStartedAt: string | null;
  responseParsedAt: string | null;
  responseRequestId?: string | null;
  responseStarted: boolean;
  serverTiming?: OpcoServerTimingMetric[];
  timeoutMs: number;
};

export type OpcoDiagnosticRequestOperation =
  | "SAVE"
  | "DAY_LOAD"
  | "REFRESH_AFTER_SYNC"
  | "SEARCH"
  | "PERSON_LOAD"
  | "RECONCILE"
  | "READY_CHECK"
  | "AUTH_REFRESH"
  | "HEALTH"
  | "OTHER";

export type OpcoSessionTerminationDiagnostics = {
  errorCode: string;
  reason: "refresh_invalid" | "token_invalid" | "user_sign_out";
  requestId: string | null;
  source: "AUTH_REFRESH" | "AUTHENTICATED_REQUEST" | "USER";
  timestamp: string;
};

export type OpcoServerTimingMetric = {
  description: string | null;
  durationMs: number | null;
  name: string;
};

type OpcoRequestInit = RequestInit & {
  diagnosticAttemptNumber?: number | null;
  diagnosticOperation?: OpcoDiagnosticRequestOperation;
  diagnosticSyncRunId?: string | null;
  timeoutMs?: number;
};

export class OpcoNetworkError extends Error {
  constructor(
    message = "No fue posible conectar con Opco.",
    public readonly diagnostics?: OpcoNetworkDiagnostics,
  ) {
    super(message);
    this.name = "OpcoNetworkError";
  }
}

type FetchLike = typeof fetch;

type ApiClientOptions = {
  apiUrl?: string;
  clientId?: string;
  fetcher?: FetchLike;
  onSessionInvalid?: (diagnostics: OpcoSessionTerminationDiagnostics) => void;
  onRequestDiagnostics?: (diagnostics: OpcoNetworkDiagnostics) => void;
  onSessionRefreshed?: (tokens: RefreshResponse) => void;
  platformOS?: PlatformOS;
  tokenStore?: SessionTokenStore;
  timeoutMs?: number;
};

type PlatformOS = "web" | "ios" | "android" | "macos" | "windows" | string;

export const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;
export const AUTH_REFRESH_TIMEOUT_MS = 30_000;
const NATIVE_CLIENT_PLATFORM_HEADER = "native";
const OPCO_REQUEST_ID_HEADER = "X-Opco-Request-Id";
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

export function parseApiEnvelope<T>(body: unknown, status = 200, diagnosticRequestId?: string | null): T {
  if (!isApiEnvelope<T>(body)) {
    throw new OpcoApiError("Respuesta inesperada de Opco.", "INVALID_API_ENVELOPE", status, undefined, diagnosticRequestId);
  }

  if (!body.ok) {
    throw new OpcoApiError(body.error.message, body.error.code, status, body.error.details, diagnosticRequestId);
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

  async function request<T>(path: string, init: OpcoRequestInit = {}) {
    let response: Response;
    let abortControllerTriggered = false;
    let fetchResolvedAt: Date | null = null;
    let responseStarted = false;
    let responseBodyStartedAt: Date | null = null;
    let responseParsedAt: Date | null = null;
    let responseRequestId: string | null = null;
    let serverTiming: OpcoServerTimingMetric[] = [];
    const requestStartedAt = new Date();
    const requestStartedMs = Date.now();
    const diagnosticAttemptNumber = normalizeDiagnosticAttemptNumber(init.diagnosticAttemptNumber);
    const diagnosticRequestId = getDiagnosticRequestId(init);
    const diagnosticOperation = init.diagnosticOperation ?? "OTHER";
    const diagnosticSyncRunId = init.diagnosticSyncRunId ?? null;
    const requestTimeoutMs = init.timeoutMs ?? timeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      abortControllerTriggered = true;
      controller.abort();
    }, requestTimeoutMs);
    const {
      diagnosticAttemptNumber: _diagnosticAttemptNumber,
      diagnosticOperation: _diagnosticOperation,
      diagnosticSyncRunId: _diagnosticSyncRunId,
      timeoutMs: _timeoutMs,
      ...fetchInit
    } = init;

    try {
      response = await fetcher(`${apiUrl}${path}`, {
        ...fetchInit,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...fetchInit.headers,
          [OPCO_REQUEST_ID_HEADER]: diagnosticRequestId,
        },
      });
      responseStarted = true;
      fetchResolvedAt = new Date();
      responseRequestId = sanitizeDiagnosticRequestId(response.headers.get(OPCO_REQUEST_ID_HEADER));
      serverTiming = parseServerTimingHeader(response.headers.get("Server-Timing"));
    } catch (error) {
      const diagnostics = requestDiagnostics({
        abortControllerTriggered,
        attemptNumber: diagnosticAttemptNumber,
        diagnosticOperation,
        diagnosticRequestId,
        diagnosticSyncRunId,
        errorCode: null,
        fetchResolvedAt,
        httpStatus: null,
        init,
        path,
        requestStartedAt,
        requestStartedMs,
        responseBodyStartedAt,
        responseParsedAt,
        responseRequestId,
        responseStarted,
        serverTiming,
        timeoutMs: requestTimeoutMs,
      });
      options.onRequestDiagnostics?.(diagnostics);

      if (isAbortError(error)) {
        throw new OpcoNetworkError("La solicitud a Opco agoto el tiempo de espera.", diagnostics);
      }

      throw new OpcoNetworkError("No fue posible conectar con Opco.", diagnostics);
    } finally {
      clearTimeout(timeoutId);
    }

    responseBodyStartedAt = new Date();
    const body = await response.json().catch(() => null);
    responseParsedAt = new Date();
    const errorCode = apiEnvelopeErrorCode(body);
    options.onRequestDiagnostics?.(requestDiagnostics({
      abortControllerTriggered,
      attemptNumber: diagnosticAttemptNumber,
      diagnosticOperation,
      diagnosticRequestId,
      diagnosticSyncRunId,
      errorCode,
      fetchResolvedAt,
      httpStatus: response.status,
      init,
      path,
      requestStartedAt,
      requestStartedMs,
      responseBodyStartedAt,
      responseParsedAt,
      responseRequestId,
      responseStarted,
      serverTiming,
      timeoutMs: requestTimeoutMs,
    }));

    return parseApiEnvelope<T>(body, response.status, diagnosticRequestId);
  }

  async function authenticatedRequest<T>(path: string, token: string, init: OpcoRequestInit = {}) {
    try {
      return await request<T>(path, withAuthHeaders(init, token));
    } catch (error) {
      if (!shouldRefresh(error)) {
        await clearInvalidSession(error);
        throw error;
      }
    }

    const refreshed = await refreshSession({
      diagnosticSyncRunId: init.diagnosticSyncRunId,
    });

    try {
      return await request<T>(path, withAuthHeaders(init, refreshed.accessToken));
    } catch (error) {
      await clearInvalidSession(error);
      throw error;
    }
  }

  async function refreshSession(refreshOptions: { diagnosticSyncRunId?: string | null; timeoutMs?: number } = {}) {
    if (!refreshPromise) {
      refreshPromise = performRefresh(refreshOptions)
        .then(async (tokens) => {
          await tokenStore?.setSession(tokens);
          options.onSessionRefreshed?.(tokens);
          return tokens;
        })
        .catch(async (error) => {
          if (isInvalidRefreshError(error)) {
            await tokenStore?.clearSession();
            options.onSessionInvalid?.(sessionTerminationDiagnostics({
              error,
              requestId: null,
              reason: "refresh_invalid",
              source: "AUTH_REFRESH",
            }));
          }

          throw error;
        })
        .finally(() => {
          refreshPromise = null;
        });
    }

    return refreshPromise;
  }

  async function performRefresh(refreshOptions: { diagnosticSyncRunId?: string | null; timeoutMs?: number } = {}) {
    if (platformOS === "web") {
      return request<RefreshResponse>("/api/v1/auth/refresh", {
        credentials: "include",
        diagnosticOperation: "AUTH_REFRESH",
        diagnosticSyncRunId: refreshOptions.diagnosticSyncRunId,
        method: "POST",
        timeoutMs: refreshOptions.timeoutMs ?? AUTH_REFRESH_TIMEOUT_MS,
      });
    }

    const refreshToken = await tokenStore?.getRefreshToken();

    if (!refreshToken) {
      throw new OpcoApiError("La sesion local no tiene refresh token.", "REFRESH_TOKEN_MISSING", 401);
    }

    return request<RefreshResponse>("/api/v1/auth/refresh", {
      body: JSON.stringify({ refreshToken }),
      diagnosticOperation: "AUTH_REFRESH",
      diagnosticSyncRunId: refreshOptions.diagnosticSyncRunId,
      headers: nativePlatformHeaders(),
      method: "POST",
      timeoutMs: refreshOptions.timeoutMs ?? AUTH_REFRESH_TIMEOUT_MS,
    });
  }

  function authHeaders(token: string) {
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  function withAuthHeaders(init: OpcoRequestInit, token: string): OpcoRequestInit {
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
      options.onSessionInvalid?.(sessionTerminationDiagnostics({
        error,
        requestId: null,
        reason: "token_invalid",
        source: "AUTHENTICATED_REQUEST",
      }));
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
      diagnosticOperation?: OpcoDiagnosticRequestOperation,
      diagnosticSyncRunId?: string | null,
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
        {
          diagnosticOperation: diagnosticOperation ?? attendanceDiagnosticOperation(normalizedQuery),
          diagnosticSyncRunId,
        },
      ).then(normalizeAttendanceResponse);
    },
    getStateUpdateWorkflow(
      token: string,
      contractId: string,
      appViewId: string,
      query: StateUpdateWorkflowQuery = {},
      options: { diagnosticSyncRunId?: string | null } = {},
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
        {
          diagnosticOperation: query.subjectRecordId?.trim() ? "RECONCILE" : stateUpdateReadDiagnosticOperation(query),
          diagnosticSyncRunId: options.diagnosticSyncRunId,
        },
      ).then(normalizeStateUpdateResponse);
    },
    saveAttendanceWorkflow(
      token: string,
      contractId: string,
      appViewId: string,
      input: AttendanceBatchRequest,
      options: { diagnosticSyncRunId?: string | null } = {},
    ) {
      return authenticatedRequest<AttendanceBatchResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/views/${encodeURIComponent(appViewId)}/workflow/attendance`,
        token,
        {
          body: JSON.stringify(input),
          diagnosticOperation: "SAVE",
          diagnosticSyncRunId: options.diagnosticSyncRunId,
          method: "POST",
        },
      ).then(normalizeAttendanceBatchResponse);
    },
    saveStateUpdateWorkflow(
      token: string,
      contractId: string,
      appViewId: string,
      input: StateUpdateRequest,
      options: { diagnosticSyncRunId?: string | null } = {},
    ) {
      return authenticatedRequest<StateUpdateApiResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/views/${encodeURIComponent(appViewId)}/workflow/state-update`,
        token,
        {
          body: JSON.stringify(serializeStateUpdateRequest(input)),
          diagnosticOperation: "SAVE",
          diagnosticSyncRunId: options.diagnosticSyncRunId,
          method: "POST",
        },
      ).then(normalizeStateUpdateBatchResponse);
    },
    getHealth() {
      return request<unknown>("/api/v1/health", {
        diagnosticOperation: "HEALTH",
      });
    },
    getReady(options: { diagnosticAttemptNumber?: number | null; diagnosticOperation?: OpcoDiagnosticRequestOperation; diagnosticSyncRunId?: string | null; timeoutMs?: number } = {}) {
      return request<unknown>("/api/v1/ready", {
        diagnosticAttemptNumber: options.diagnosticAttemptNumber,
        diagnosticOperation: options.diagnosticOperation ?? "READY_CHECK",
        diagnosticSyncRunId: options.diagnosticSyncRunId,
        timeoutMs: options.timeoutMs,
      });
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
  const normalizedStatuses = normalizeAttendanceStatuses(response);

  response.latest.forEach((item) => {
    assertIsoDateTime(item.updatedAt, "Opco devolvio un updatedAt invalido para el ultimo registro de asistencia.");
  });

  return {
    ...response,
    statuses: normalizedStatuses,
    items: response.items.map((item) => {
      if (item.attendance) {
        assertIsoDateTime(item.attendance.updatedAt, "Opco devolvio un updatedAt invalido para la asistencia.");
      }

      return item;
    }),
  };
}

function normalizeAttendanceStatuses(response: AttendanceResponse): AttendanceStatusOption[] {
  if (Array.isArray(response.statuses) && response.statuses.length > 0) {
    return response.statuses;
  }

  const stateFields = (response as AttendanceResponse & { stateFields?: StateUpdateField[] }).stateFields;
  const statusField = stateFields?.[0];

  if (!statusField) {
    return [];
  }

  return statusField.options.map((option) => ({
    isDefaultCheckIn: statusField.defaultOptionId ? option.optionId === statusField.defaultOptionId : false,
    label: option.label,
    optionId: option.optionId,
  }));
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
    assertIsoDateTime(item.updatedAt, "Opco devolvio un updatedAt invalido para el ultimo cambio de estado.");
  });

  response.items.forEach((item) => {
    if (item.current) {
      assertIsoDateTime(item.current.updatedAt, "Opco devolvio un updatedAt invalido para el estado actual.");
    }
  });

  return response;
}

function normalizeStateUpdateBatchResponse(response: StateUpdateApiResponse): StateUpdateBatchResponse {
  const results = (response.results ?? ("result" in response && response.result ? [response.result] : []))
    .map(normalizeStateUpdateBatchResult);

  results.forEach((result) => {
    if (result.result === "CONFLICT") {
      assertIsoDateTime(result.existing.updatedAt, "Opco devolvio un updatedAt invalido para el conflicto de estado.");
      return;
    }

    if (result.result !== "ERROR") {
      assertIsoDateTime(result.updatedAt, "Opco devolvio un updatedAt invalido para el cambio de estado.");
    }
  });

  return {
    ...response,
    results,
  };
}

function serializeStateUpdateRequest(input: StateUpdateRequest) {
  return {
    clientRequestId: input.clientRequestId,
    date: input.date,
    expectedUpdatedAt: input.expectedUpdatedAt,
    extraValues: input.extraValues,
    overwrite: input.overwrite,
    states: stateValuesToStates(input.stateValues),
    subjectRecordId: input.subjectRecordId,
  };
}

function normalizeStateUpdateBatchResult(result: StateUpdateApiResult): StateUpdateBatchResult {
  if (result.result !== "CONFLICT") {
    return result;
  }

  return {
    existing: {
      recordId: result.existing.recordId,
      stateValues: result.differences.map((difference) => ({
        fieldId: difference.fieldId,
        label: difference.existingLabel,
        optionId: difference.existingOptionId,
      })),
      updatedAt: result.existing.updatedAt,
    },
    requested: {
      stateValues: result.differences.map((difference) => ({
        fieldId: difference.fieldId,
        label: difference.requestedLabel,
        optionId: difference.requestedOptionId,
      })),
    },
    result: "CONFLICT",
    subjectRecordId: result.subjectRecordId,
  };
}

function stateValuesToStates(stateValues: StateUpdateEntry["stateValues"]) {
  return Object.fromEntries(
    stateValues
      .filter((value): value is { fieldId: string; optionId: string } => typeof value.optionId === "string" && value.optionId.trim().length > 0)
      .map((value) => [value.fieldId, value.optionId]),
  );
}

function requestDiagnostics({
  abortControllerTriggered,
  attemptNumber,
  diagnosticOperation,
  diagnosticRequestId,
  diagnosticSyncRunId,
  errorCode,
  fetchResolvedAt,
  httpStatus,
  init,
  path,
  requestStartedAt,
  requestStartedMs,
  responseBodyStartedAt,
  responseParsedAt,
  responseRequestId,
  responseStarted,
  serverTiming,
  timeoutMs,
}: {
  abortControllerTriggered: boolean;
  attemptNumber: number | null;
  diagnosticOperation: OpcoDiagnosticRequestOperation;
  diagnosticRequestId: string;
  diagnosticSyncRunId: string | null;
  errorCode: string | null;
  fetchResolvedAt: Date | null;
  httpStatus: number | null;
  init: OpcoRequestInit;
  path: string;
  requestStartedAt: Date;
  requestStartedMs: number;
  responseBodyStartedAt: Date | null;
  responseParsedAt: Date | null;
  responseRequestId: string | null;
  responseStarted: boolean;
  serverTiming: OpcoServerTimingMetric[];
  timeoutMs: number;
}): OpcoNetworkDiagnostics {
  return {
    abortControllerTriggered,
    attemptNumber,
    diagnosticOperation,
    diagnosticRequestId,
    diagnosticSyncRunId,
    errorCode,
    fetchResolvedAt: fetchResolvedAt?.toISOString() ?? null,
    httpStatus,
    method: String(init.method ?? "GET").toUpperCase(),
    pathTemplate: templateApiPath(path),
    requestCompletedAt: new Date().toISOString(),
    requestDurationMs: Date.now() - requestStartedMs,
    requestStartedAt: requestStartedAt.toISOString(),
    responseBodyStartedAt: responseBodyStartedAt?.toISOString() ?? null,
    responseParsedAt: responseParsedAt?.toISOString() ?? null,
    responseRequestId,
    responseStarted,
    serverTiming,
    timeoutMs,
  };
}

function normalizeDiagnosticAttemptNumber(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 99 ? value : null;
}

function apiEnvelopeErrorCode(body: unknown) {
  if (!body || typeof body !== "object") {
    return null;
  }

  const envelope = body as Partial<ApiEnvelope<unknown>>;

  return envelope.ok === false && envelope.error && typeof envelope.error.code === "string"
    ? envelope.error.code
    : null;
}

function sessionTerminationDiagnostics({
  error,
  reason,
  requestId,
  source,
}: {
  error: OpcoApiError;
  reason: OpcoSessionTerminationDiagnostics["reason"];
  requestId: string | null;
  source: OpcoSessionTerminationDiagnostics["source"];
}): OpcoSessionTerminationDiagnostics {
  return {
    errorCode: error.code,
    reason,
    requestId: error.diagnosticRequestId ?? requestId,
    source,
    timestamp: new Date().toISOString(),
  };
}

function getDiagnosticRequestId(init: OpcoRequestInit) {
  const existing = headersGet(init.headers, OPCO_REQUEST_ID_HEADER);

  return sanitizeDiagnosticRequestId(existing) ?? createDiagnosticRequestId();
}

function headersGet(headers: HeadersInit | undefined, key: string) {
  if (!headers) {
    return null;
  }

  if (headers instanceof Headers) {
    return headers.get(key);
  }

  if (Array.isArray(headers)) {
    const found = headers.find(([name]) => name.toLowerCase() === key.toLowerCase());

    return found?.[1] ?? null;
  }

  return Object.entries(headers).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1] ?? null;
}

function createDiagnosticRequestId() {
  return `opco_diag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeDiagnosticRequestId(value: string | null | undefined) {
  if (!value || !/^[A-Za-z0-9._:-]{1,96}$/.test(value)) {
    return null;
  }

  return value;
}

export function parseServerTimingHeader(value: string | null | undefined): OpcoServerTimingMetric[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [rawName, ...params] = entry.split(";").map((part) => part.trim());
      const name = /^[A-Za-z0-9_-]{1,40}$/.test(rawName) ? rawName : null;

      if (!name) {
        return null;
      }

      let durationMs: number | null = null;
      let description: string | null = null;

      for (const param of params) {
        const [paramName, rawValue = ""] = param.split("=");

        if (paramName === "dur") {
          const parsed = Number(rawValue);

          durationMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
        }

        if (paramName === "desc") {
          const unquoted = rawValue.replace(/^"|"$/g, "");
          description = /^[ A-Za-z0-9._:/-]{1,80}$/.test(unquoted) ? unquoted : null;
        }
      }

      return { description, durationMs, name };
    })
    .filter((metric): metric is OpcoServerTimingMetric => Boolean(metric));
}

function attendanceDiagnosticOperation(query: AttendanceWorkflowQuery): OpcoDiagnosticRequestOperation {
  if (query.personRecordId?.trim()) {
    return "PERSON_LOAD";
  }

  if (query.search?.trim()) {
    return "SEARCH";
  }

  return "DAY_LOAD";
}

function stateUpdateReadDiagnosticOperation(query: StateUpdateWorkflowQuery): OpcoDiagnosticRequestOperation {
  if (query.search?.trim()) {
    return "SEARCH";
  }

  return "DAY_LOAD";
}

function templateApiPath(path: string) {
  return path
    .split("?")[0]
    .replace(
      /^\/api\/v1\/contracts\/[^/]+\/views\/[^/]+\/workflow\/state-update$/,
      "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update",
    )
    .replace(
      /^\/api\/v1\/contracts\/[^/]+\/views\/[^/]+\/workflow\/attendance$/,
      "/api/v1/contracts/:contractId/views/:appViewId/workflow/attendance",
    )
    .replace(
      /^\/api\/v1\/contracts\/[^/]+\/entities\/[^/]+\/records\/[^/]+$/,
      "/api/v1/contracts/:contractId/entities/:entityTypeId/records/:recordId",
    )
    .replace(
      /^\/api\/v1\/contracts\/[^/]+\/entities\/[^/]+\/records$/,
      "/api/v1/contracts/:contractId/entities/:entityTypeId/records",
    )
    .replace(
      /^\/api\/v1\/contracts\/[^/]+\/entities\/[^/]+$/,
      "/api/v1/contracts/:contractId/entities/:entityTypeId",
    )
    .replace(
      /^\/api\/v1\/contracts\/[^/]+\/views$/,
      "/api/v1/contracts/:contractId/views",
    )
    .replace(
      /^\/api\/v1\/contracts\/[^/]+\/entities$/,
      "/api/v1/contracts/:contractId/entities",
    );
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
