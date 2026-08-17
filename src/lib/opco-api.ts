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

export type WorkflowAppViewConfig = Record<string, unknown>;
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

export type EntityField = {
  id: string;
  key: string;
  name: string;
  type: string;
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
  timeoutMs?: number;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;

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
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

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

  function authHeaders(token: string) {
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  return {
    login(email: string, password: string) {
      return request<LoginResponse>("/api/v1/auth/login", {
        body: JSON.stringify({
          email,
          password,
          clientId,
        }),
        method: "POST",
      });
    },
    getMe(token: string) {
      return request<MeResponse>("/api/v1/me", {
        headers: authHeaders(token),
      });
    },
    getContext(token: string) {
      return request<ContextResponse>("/api/v1/context", {
        headers: authHeaders(token),
      });
    },
    getEntities(token: string, contractId: string) {
      return request<EntitiesResponse>(`/api/v1/contracts/${encodeURIComponent(contractId)}/entities`, {
        headers: authHeaders(token),
      });
    },
    getAppViews(token: string, contractId: string) {
      return request<AppViewsResponse>(`/api/v1/contracts/${encodeURIComponent(contractId)}/views`, {
        headers: authHeaders(token),
      });
    },
    getEntityDefinition(token: string, contractId: string, entityTypeId: string) {
      return request<EntityDefinitionResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/entities/${encodeURIComponent(entityTypeId)}`,
        {
          headers: authHeaders(token),
        },
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

      return request<EntityRecordsResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/entities/${encodeURIComponent(entityTypeId)}/records${
          serializedQuery ? `?${serializedQuery}` : ""
        }`,
        {
          headers: authHeaders(token),
        },
      );
    },
    getEntityRecord(token: string, contractId: string, entityTypeId: string, recordId: string) {
      return request<EntityRecordResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/entities/${encodeURIComponent(
          entityTypeId,
        )}/records/${encodeURIComponent(recordId)}`,
        {
          headers: authHeaders(token),
        },
      );
    },
    createEntityRecord(token: string, contractId: string, entityTypeId: string, input: CreateEntityRecordInput) {
      return request<EntityRecordResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/entities/${encodeURIComponent(entityTypeId)}/records`,
        {
          body: JSON.stringify(input),
          headers: authHeaders(token),
          method: "POST",
        },
      );
    },
    updateEntityRecord(
      token: string,
      contractId: string,
      entityTypeId: string,
      recordId: string,
      input: UpdateEntityRecordInput,
    ) {
      return request<EntityRecordResponse>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/entities/${encodeURIComponent(
          entityTypeId,
        )}/records/${encodeURIComponent(recordId)}`,
        {
          body: JSON.stringify(input),
          headers: authHeaders(token),
          method: "PATCH",
        },
      );
    },
  };
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export type OpcoApi = ReturnType<typeof createOpcoApi>;

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
