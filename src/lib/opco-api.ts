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

export type AppViewType = "RECORDS" | "WORKFLOW" | "REPORT" | "BOARD" | "DASHBOARD";

export type RecordsAppViewConfig = {
  entityTypeId: string;
};

export type ReportAppViewConfig = {
  entityTypeId: string;
  dateFieldId: string;
  timeFilter?: ReportTimeFilterConfig;
  valueDisplay?: Record<string, ReportSelectValueDisplay>;
} & (
  | {
      presentationMode: "TABLE";
      table: {
        visibleFieldIds: string[];
        defaultSortFieldId?: string;
        defaultSortDirection: "asc" | "desc";
      };
    }
  | {
      presentationMode: "MATRIX";
      matrix: {
        rowFieldId: string;
        columnFieldId: string;
        valueFieldId: string;
        summaryFieldId?: string;
      };
    }
);

export type ReportTimeFilterConfig = {
  mode: "RANGE" | "MONTH";
  defaultPeriod: "CURRENT_MONTH";
  allowChange: boolean;
};

export type ReportSelectValueDisplay = "LABEL" | "INTERNAL_VALUE";

export type AttendanceWorkflowConfig = {
  contextFieldIds?: string[];
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

export type ReportAppView = {
  config: ReportAppViewConfig;
  icon: string | null;
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  type: "REPORT";
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

export type AppView = RecordsAppView | WorkflowAppView | ReportAppView | BoardAppView | DashboardAppView;

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

export type ReportQuery = {
  from?: string;
  to?: string;
};

export type ReportResponse = {
  appView: {
    id: string;
    name: string;
    slug: string;
  };
  config: ReportAppViewConfig;
  entity: {
    id: string;
    name: string;
    slug: string;
  };
  fields: EntityField[];
  from: string;
  records: EntityRecord[];
  to: string;
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

export type AttendanceContextField = {
  id: string;
  key?: string;
  name: string;
  options: {
    label: string;
    optionId: string;
    order?: number;
    value?: string;
  }[];
  required: boolean;
  type: "SELECT";
};

export type AttendanceContextValues = Record<string, { label: string; optionId: string } | string | null>;

export type AttendanceItem = {
  attendance: {
    contextValues?: AttendanceContextValues;
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
  contextValues?: AttendanceContextValues;
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
  contextFields?: AttendanceContextField[];
  date: string;
  items: AttendanceItem[];
  latest: AttendanceLatestItem[];
  sourceEntityType: {
    id: string;
    name: string;
  };
  stateFields?: StateUpdateField[];
  statuses: AttendanceStatusOption[];
  statusFieldId?: string;
  summary: {
    totalRegistered: number;
  };
  targetEntityType: {
    id: string;
    name: string;
  };
};

export type AttendanceBatchEntry = {
  contextValues?: Record<string, string | null>;
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
  value?: string;
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

export type StateUpdateConflictExtraValue = {
  fieldId: string;
  fieldLabel?: string | null;
  fieldType?: EntityFieldType | string | null;
  localValue?: EntityRecordValue;
  remoteValue?: EntityRecordValue;
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

type StateUpdateRawCurrent = Omit<NonNullable<StateUpdateCurrent>, "stateValues"> & {
  stateValues?: StateUpdateCurrentFieldValue[];
  states?: Record<string, { label?: string | null; optionId?: string | null } | null>;
};

type StateUpdateRawItem = Omit<StateUpdateItem, "current"> & {
  current: StateUpdateRawCurrent | null;
};

type StateUpdateRawLatestItem = Omit<StateUpdateLatestItem, "stateValues"> & {
  stateValues?: StateUpdateCurrentFieldValue[];
  states?: Record<string, { label?: string | null; optionId?: string | null } | null>;
};

type StateUpdateRawField = StateUpdateField | {
  defaultOptionId?: string | null;
  field?: EntityField;
  options?: StateUpdateOption[];
  required?: boolean;
};

type StateUpdateRawResponse = Omit<StateUpdateResponse, "items" | "latest" | "sourceEntityType" | "stateFields"> & {
  items?: StateUpdateRawItem[];
  latest?: StateUpdateRawLatestItem[];
  sourceEntityType?: StateUpdateResponse["sourceEntityType"];
  stateFields?: StateUpdateRawField[];
  subjectEntityType?: StateUpdateResponse["sourceEntityType"];
  subjects?: StateUpdateRawItem[];
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
        extraValues?: Record<string, EntityRecordValue>;
        recordId: string;
        stateValues: StateUpdateCurrentFieldValue[];
        updatedAt: string;
      };
      requested: {
        extraValues?: Record<string, EntityRecordValue>;
        stateValues: StateUpdateCurrentFieldValue[];
      };
      extraValues?: StateUpdateConflictExtraValue[];
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
    existingValue?: EntityRecordValue;
    existingLabel?: string | null;
    existingOptionId?: string | null;
    fieldId: string;
    fieldLabel?: string | null;
    fieldType?: EntityFieldType | string | null;
    localValue?: EntityRecordValue;
    remoteValue?: EntityRecordValue;
    requestedLabel?: string | null;
    requestedOptionId?: string | null;
    requestedValue?: EntityRecordValue;
    source?: "extra" | "state" | string | null;
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
  operationResult?: OpcoDiagnosticOperationResult;
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

export type OpcoDiagnosticOperationResult =
  | "diagnostics_error"
  | "http_error"
  | "network_error"
  | "response_parse_error"
  | "response_validation_error"
  | "success"
  | "transport_timeout"
  | "unknown";

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

type OpcoResponseParser<T> = (body: unknown, status: number, diagnosticRequestId?: string | null) => T;

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

function parseReadyResponse(body: unknown, status = 200, diagnosticRequestId?: string | null) {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const readyBody = body as { reason?: unknown; status?: unknown };

    if (readyBody.status === "ready") {
      return readyBody;
    }

    if (readyBody.status === "not_ready") {
      throw new OpcoApiError(
        "Operational Core no esta listo.",
        readyBody.reason === "database" ? "DB_UNAVAILABLE" : "NOT_READY",
        status,
        undefined,
        diagnosticRequestId,
      );
    }
  }

  throw new OpcoApiError("Respuesta inesperada de Opco.", "INVALID_READY_RESPONSE", status, undefined, diagnosticRequestId);
}

export function createOpcoApi(options: ApiClientOptions = {}) {
  const apiUrl = trimTrailingSlash(options.apiUrl ?? config.apiUrl);
  const clientId = options.clientId ?? config.clientId;
  const fetcher = options.fetcher ?? fetch;
  const platformOS = options.platformOS ?? getDefaultPlatformOS();
  const tokenStore = options.tokenStore;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  let refreshPromise: Promise<RefreshResponse> | null = null;

  async function request<T>(path: string, init: OpcoRequestInit = {}, parser: OpcoResponseParser<T> = parseApiEnvelope<T>) {
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
        operationResult: isAbortError(error) ? "transport_timeout" : "network_error",
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
      safeRequestDiagnostics(options.onRequestDiagnostics, diagnostics);

      if (isAbortError(error)) {
        throw new OpcoNetworkError("La solicitud a Opco agoto el tiempo de espera.", diagnostics);
      }

      throw new OpcoNetworkError("No fue posible conectar con Opco.", diagnostics);
    } finally {
      clearTimeout(timeoutId);
    }

    responseBodyStartedAt = new Date();
    let body: unknown = null;
    let responseParseFailed = false;

    try {
      body = await response.json();
    } catch {
      responseParseFailed = true;
    }

    responseParsedAt = new Date();
    const errorCode = apiEnvelopeErrorCode(body);

    try {
      const parsed = responseParseFailed
        ? parseApiEnvelope<T>(body, response.status, diagnosticRequestId)
        : parser(body, response.status, diagnosticRequestId);
      safeRequestDiagnostics(options.onRequestDiagnostics, requestDiagnostics({
        abortControllerTriggered,
        attemptNumber: diagnosticAttemptNumber,
        diagnosticOperation,
        diagnosticRequestId,
        diagnosticSyncRunId,
        errorCode,
        fetchResolvedAt,
        httpStatus: response.status,
        init,
        operationResult: response.status >= 400 ? "http_error" : "success",
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

      return parsed;
    } catch (error) {
      safeRequestDiagnostics(options.onRequestDiagnostics, requestDiagnostics({
        abortControllerTriggered,
        attemptNumber: diagnosticAttemptNumber,
        diagnosticOperation,
        diagnosticRequestId,
        diagnosticSyncRunId,
        errorCode: error instanceof OpcoApiError ? error.code : errorCode,
        fetchResolvedAt,
        httpStatus: response.status,
        init,
        operationResult: classifyResponseOperationResult({ error, responseParseFailed, status: response.status }),
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

      throw error;
    }
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
    getReport(token: string, contractId: string, appViewId: string, query: ReportQuery = {}) {
      const searchParams = new URLSearchParams();

      if (query.from) {
        searchParams.set("from", query.from);
      }

      if (query.to) {
        searchParams.set("to", query.to);
      }

      const serializedQuery = searchParams.toString();

      return authenticatedRequest<ReportResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/reports/${encodeURIComponent(appViewId)}${
          serializedQuery ? `?${serializedQuery}` : ""
        }`,
        token,
      );
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

      return authenticatedRequest<StateUpdateRawResponse>(
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
      }, parseReadyResponse);
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
    contextFields: response.contextFields ?? [],
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
  const statusField = response.statusFieldId
    ? stateFields?.find((field) => field.fieldId === response.statusFieldId)
    : stateFields?.[0];
  const legacyStatusField = statusField ?? stateFields?.[0];

  if (!legacyStatusField) {
    return [];
  }

  return legacyStatusField.options.map((option) => ({
    isDefaultCheckIn: legacyStatusField.defaultOptionId ? option.optionId === legacyStatusField.defaultOptionId : false,
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

function normalizeStateUpdateResponse(response: StateUpdateRawResponse): StateUpdateResponse {
  const rawItems = response.subjects ?? response.items ?? [];
  const items = rawItems.map((item) => ({
    ...item,
    current: normalizeStateUpdateCurrent(item.current),
  }));
  const latest = (response.latest ?? []).map((item) => ({
    ...item,
    stateValues: normalizeStateUpdateFieldValues(item.stateValues, item.states),
  }));
  const extraFields = response.extraFields ?? [];
  const stateFields = (response.stateFields ?? []).map(normalizeStateUpdateField);
  const sourceEntityType = normalizeStateUpdateSourceEntityType(response);

  latest.forEach((item) => {
    assertIsoDateTime(item.updatedAt, "Opco devolvio un updatedAt invalido para el ultimo cambio de estado.");
  });

  items.forEach((item) => {
    if (item.current) {
      assertIsoDateTime(item.current.updatedAt, "Opco devolvio un updatedAt invalido para el estado actual.");
    }
  });

  return {
    ...response,
    extraFields,
    items,
    latest,
    sourceEntityType,
    stateFields,
  };
}

function normalizeStateUpdateCurrent(current: StateUpdateRawCurrent | null): StateUpdateCurrent {
  if (!current) {
    return null;
  }

  return {
    ...current,
    stateValues: normalizeStateUpdateFieldValues(current.stateValues, current.states),
  };
}

function normalizeStateUpdateFieldValues(
  stateValues?: StateUpdateCurrentFieldValue[],
  states?: Record<string, { label?: string | null; optionId?: string | null } | null>,
): StateUpdateCurrentFieldValue[] {
  if (Array.isArray(stateValues)) {
    return stateValues;
  }

  if (!states) {
    return [];
  }

  return Object.entries(states).map(([fieldId, value]) => ({
    fieldId,
    label: value?.label ?? null,
    optionId: value?.optionId ?? null,
  }));
}

function normalizeStateUpdateField(field: StateUpdateRawField): StateUpdateField {
  if ("fieldId" in field && typeof field.fieldId === "string") {
    return {
      ...field,
      options: field.options ?? [],
    };
  }

  const coreField = "field" in field ? field.field : undefined;

  return {
    defaultOptionId: field.defaultOptionId ?? undefined,
    fieldId: coreField?.id ?? "",
    key: coreField?.key,
    label: coreField?.name ?? "",
    name: coreField?.name,
    options: field.options ?? [],
    required: field.required ?? false,
  };
}

function normalizeStateUpdateSourceEntityType(response: StateUpdateRawResponse): StateUpdateResponse["sourceEntityType"] {
  const sourceEntityType = response.sourceEntityType ?? response.subjectEntityType;

  if (!sourceEntityType) {
    throw new Error("Opco no devolvio la entidad fuente del workflow de estado.");
  }

  return sourceEntityType;
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

  const stateDifferences = result.differences.filter((difference) => !isStateUpdateExtraDifference(difference));
  const extraDifferences = result.differences
    .filter(isStateUpdateExtraDifference)
    .map((difference) => ({
      fieldId: difference.fieldId,
      fieldLabel: difference.fieldLabel,
      fieldType: difference.fieldType,
      localValue: readConflictLocalValue(difference),
      remoteValue: readConflictRemoteValue(difference),
    }));

  return {
    existing: {
      extraValues: objectFromConflictExtraValues(extraDifferences, "remoteValue"),
      recordId: result.existing.recordId,
      stateValues: stateDifferences.map((difference) => ({
        fieldId: difference.fieldId,
        label: difference.existingLabel ?? null,
        optionId: difference.existingOptionId ?? null,
      })),
      updatedAt: result.existing.updatedAt,
    },
    extraValues: extraDifferences.length > 0 ? extraDifferences : undefined,
    requested: {
      extraValues: objectFromConflictExtraValues(extraDifferences, "localValue"),
      stateValues: stateDifferences.map((difference) => ({
        fieldId: difference.fieldId,
        label: difference.requestedLabel ?? null,
        optionId: difference.requestedOptionId ?? null,
      })),
    },
    result: "CONFLICT",
    subjectRecordId: result.subjectRecordId,
  };
}

function isStateUpdateExtraDifference(difference: StateUpdateApiConflictResult["differences"][number]) {
  return difference.source === "extra" ||
    "existingValue" in difference ||
    "requestedValue" in difference ||
    "remoteValue" in difference ||
    "localValue" in difference;
}

function readConflictRemoteValue(difference: StateUpdateApiConflictResult["differences"][number]) {
  if ("remoteValue" in difference) {
    return difference.remoteValue;
  }

  return difference.existingValue;
}

function readConflictLocalValue(difference: StateUpdateApiConflictResult["differences"][number]) {
  if ("localValue" in difference) {
    return difference.localValue;
  }

  return difference.requestedValue;
}

function objectFromConflictExtraValues(
  differences: StateUpdateConflictExtraValue[],
  key: "localValue" | "remoteValue",
) {
  const entries = differences
    .filter((difference): difference is StateUpdateConflictExtraValue & Record<typeof key, EntityRecordValue> =>
      key in difference && difference[key] !== undefined)
    .map((difference) => [difference.fieldId, difference[key]] as const);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
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
  operationResult,
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
  operationResult: OpcoDiagnosticOperationResult;
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
    operationResult,
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

function safeRequestDiagnostics(
  recorder: ApiClientOptions["onRequestDiagnostics"],
  diagnostics: OpcoNetworkDiagnostics,
) {
  try {
    recorder?.(diagnostics);
  } catch {
    // Request diagnostics are observational and must never reject API calls.
  }
}

function classifyResponseOperationResult({
  error,
  responseParseFailed,
  status,
}: {
  error: unknown;
  responseParseFailed: boolean;
  status: number;
}): OpcoDiagnosticOperationResult {
  if (responseParseFailed) {
    return "response_parse_error";
  }

  if (status >= 400) {
    return "http_error";
  }

  if (error instanceof OpcoApiError) {
    return "response_validation_error";
  }

  return "unknown";
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
