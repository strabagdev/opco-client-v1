import { afterEach, describe, expect, it, vi } from "vitest";

import { createOpcoApi, OpcoApiError, OpcoNetworkError, parseApiEnvelope } from "./opco-api";
import { appViewsFixture, entityRecordFixture } from "../test/fixtures";

const meFixture = {
  app: {
    clientId: "opco_app_123",
    id: "app_1",
    name: "Materiales App",
    slug: "materiales-app",
  },
  user: {
    email: "user@example.com",
    id: "user_1",
    name: null,
  },
};

afterEach(() => {
  vi.useRealTimers();
});

describe("parseApiEnvelope", () => {
  it("returns success data", () => {
    expect(parseApiEnvelope({ ok: true, data: { value: 1 } })).toEqual({ value: 1 });
  });

  it("throws structured Opco errors", () => {
    expect(() =>
      parseApiEnvelope(
        {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Credenciales invalidas.",
          },
          ok: false,
        },
        401,
      ),
    ).toThrow(OpcoApiError);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function createSessionTokenStore(refreshToken: string | null) {
  return {
    clearSession: vi.fn(async () => undefined),
    getRefreshToken: vi.fn(async () => refreshToken),
    setSession: vi.fn(async () => undefined),
  };
}

describe("createOpcoApi", () => {
  it("sends clientId when logging in", async () => {
    const requests: RequestInit[] = [];
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (_url, init) => {
        requests.push(init ?? {});

        return new Response(
          JSON.stringify({
            data: {
              accessToken: "token_123",
              expiresIn: 3600,
              tokenType: "Bearer",
            },
            ok: true,
          }),
          { status: 200 },
        );
      },
    });

    await api.login("user@example.com", "secret");

    expect(JSON.parse(String(requests[0].body))).toMatchObject({
      clientId: "opco_app_123",
      email: "user@example.com",
      password: "secret",
    });
  });

  it("includes credentials for web login without requiring a refresh token in JSON", async () => {
    const requests: RequestInit[] = [];
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (_url, init) => {
        requests.push(init ?? {});

        return jsonResponse({
          data: {
            accessToken: "access-token",
            expiresIn: 3600,
            tokenType: "Bearer",
          },
          ok: true,
        });
      },
      platformOS: "web",
    });

    await expect(api.login("user@example.com", "secret")).resolves.toMatchObject({
      accessToken: "access-token",
    });
    expect(requests[0].credentials).toBe("include");
  });

  it("sends native platform headers and stores rotated tokens on refresh", async () => {
    const requests: RequestInit[] = [];
    const store = createSessionTokenStore("refresh-token-1");
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (_url, init) => {
        requests.push(init ?? {});

        return jsonResponse({
          data: {
            accessToken: "access-token-2",
            expiresIn: 3600,
            refreshToken: "refresh-token-2",
            tokenType: "Bearer",
          },
          ok: true,
        });
      },
      platformOS: "ios",
      tokenStore: store,
    });

    await api.refreshSession();

    expect(requests[0].headers).toMatchObject({ "X-Opco-Client-Platform": "native" });
    expect(JSON.parse(String(requests[0].body))).toEqual({ refreshToken: "refresh-token-1" });
    expect(store.setSession).toHaveBeenCalledWith({
      accessToken: "access-token-2",
      expiresIn: 3600,
      refreshToken: "refresh-token-2",
      tokenType: "Bearer",
    });
  });

  it("logs out on web with credentials and no refresh token body", async () => {
    const requests: RequestInit[] = [];
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (_url, init) => {
        requests.push(init ?? {});

        return jsonResponse({
          data: null,
          ok: true,
        });
      },
      platformOS: "web",
    });

    await api.logout("refresh-token-that-should-stay-out-of-js");

    expect(requests[0].credentials).toBe("include");
    expect(requests[0].body).toBeUndefined();
  });

  it("logs out on native with the refresh token body", async () => {
    const requests: RequestInit[] = [];
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (_url, init) => {
        requests.push(init ?? {});

        return jsonResponse({
          data: null,
          ok: true,
        });
      },
      platformOS: "android",
    });

    await api.logout("refresh-token-1");

    expect(requests[0].headers).toMatchObject({ "X-Opco-Client-Platform": "native" });
    expect(JSON.parse(String(requests[0].body))).toEqual({ refreshToken: "refresh-token-1" });
  });

  it("refreshes once and retries an expired authenticated request with the new access token", async () => {
    const requests: { authorization: string | null; path: string }[] = [];
    const store = createSessionTokenStore("refresh-token-1");
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (url, init) => {
        const path = new URL(String(url)).pathname;
        const headers = new Headers(init?.headers);
        requests.push({ authorization: headers.get("authorization"), path });

        if (path === "/api/v1/me" && requests.length === 1) {
          return jsonResponse(
            {
              error: {
                code: "TOKEN_EXPIRED",
                message: "Token expirado.",
              },
              ok: false,
            },
            401,
          );
        }

        if (path === "/api/v1/auth/refresh") {
          return jsonResponse({
            data: {
              accessToken: "fresh-token",
              expiresIn: 3600,
              refreshToken: "refresh-token-2",
              tokenType: "Bearer",
            },
            ok: true,
          });
        }

        return jsonResponse({
          data: meFixture,
          ok: true,
        });
      },
      platformOS: "android",
      tokenStore: store,
    });

    await expect(api.getMe("expired-token")).resolves.toEqual(meFixture);

    expect(requests.map((request) => request.path)).toEqual([
      "/api/v1/me",
      "/api/v1/auth/refresh",
      "/api/v1/me",
    ]);
    expect(requests[0].authorization).toBe("Bearer expired-token");
    expect(requests[2].authorization).toBe("Bearer fresh-token");
  });

  it("does not refresh forever when the retried request still returns 401", async () => {
    const paths: string[] = [];
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (url) => {
        const path = new URL(String(url)).pathname;
        paths.push(path);

        if (path === "/api/v1/auth/refresh") {
          return jsonResponse({
            data: {
              accessToken: "fresh-token",
              expiresIn: 3600,
              refreshToken: "refresh-token-2",
              tokenType: "Bearer",
            },
            ok: true,
          });
        }

        return jsonResponse(
          {
            error: {
              code: "TOKEN_EXPIRED",
              message: "Token expirado.",
            },
            ok: false,
          },
          401,
        );
      },
      platformOS: "ios",
      tokenStore: createSessionTokenStore("refresh-token-1"),
    });

    await expect(api.getMe("expired-token")).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });

    expect(paths).toEqual(["/api/v1/me", "/api/v1/auth/refresh", "/api/v1/me"]);
  });

  it("shares one refresh across concurrent expired requests", async () => {
    const paths: string[] = [];
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (url) => {
        const path = new URL(String(url)).pathname;
        paths.push(path);

        if (path === "/api/v1/auth/refresh") {
          await new Promise((resolve) => setTimeout(resolve, 1));

          return jsonResponse({
            data: {
              accessToken: "fresh-token",
              expiresIn: 3600,
              refreshToken: "refresh-token-2",
              tokenType: "Bearer",
            },
            ok: true,
          });
        }

        const meCalls = paths.filter((requestPath) => requestPath === "/api/v1/me").length;

        if (meCalls <= 5) {
          return jsonResponse(
            {
              error: {
                code: "TOKEN_EXPIRED",
                message: "Token expirado.",
              },
              ok: false,
            },
            401,
          );
        }

        return jsonResponse({
          data: meFixture,
          ok: true,
        });
      },
      platformOS: "ios",
      tokenStore: createSessionTokenStore("refresh-token-1"),
    });

    await Promise.all([
      api.getMe("expired-token"),
      api.getMe("expired-token"),
      api.getMe("expired-token"),
      api.getMe("expired-token"),
      api.getMe("expired-token"),
    ]);

    expect(paths.filter((path) => path === "/api/v1/auth/refresh")).toHaveLength(1);
  });

  it("clears the local session when refresh is revoked", async () => {
    const store = createSessionTokenStore("refresh-token-1");
    const onSessionInvalid = vi.fn();
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (url) => {
        const path = new URL(String(url)).pathname;

        if (path === "/api/v1/auth/refresh") {
          return jsonResponse(
            {
              error: {
                code: "REFRESH_TOKEN_REVOKED",
                message: "Sesion revocada.",
              },
              ok: false,
            },
            401,
          );
        }

        return jsonResponse(
          {
            error: {
              code: "TOKEN_EXPIRED",
              message: "Token expirado.",
            },
            ok: false,
          },
          401,
        );
      },
      onSessionInvalid,
      platformOS: "ios",
      tokenStore: store,
    });

    await expect(api.getMe("expired-token")).rejects.toMatchObject({ code: "REFRESH_TOKEN_REVOKED" });

    expect(store.clearSession).toHaveBeenCalledOnce();
    expect(onSessionInvalid).toHaveBeenCalledOnce();
  });

  it("does not clear the local session when refresh fails because of network", async () => {
    const store = createSessionTokenStore("refresh-token-1");
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (url) => {
        const path = new URL(String(url)).pathname;

        if (path === "/api/v1/auth/refresh") {
          throw new Error("offline");
        }

        return jsonResponse(
          {
            error: {
              code: "TOKEN_EXPIRED",
              message: "Token expirado.",
            },
            ok: false,
          },
          401,
        );
      },
      platformOS: "ios",
      tokenStore: store,
    });

    await expect(api.getMe("expired-token")).rejects.toBeInstanceOf(OpcoNetworkError);
    expect(store.clearSession).not.toHaveBeenCalled();
  });

  it("normalizes trailing slashes from the base URL", async () => {
    const urls: string[] = [];
    const api = createOpcoApi({
      apiUrl: "https://opco.test/",
      clientId: "opco_app_123",
      fetcher: async (url) => {
        urls.push(String(url));

        return new Response(
          JSON.stringify({
            data: {
              app: {
                clientId: "opco_app_123",
                id: "app_1",
                name: "Materiales App",
                slug: "materiales-app",
              },
              user: {
                email: "user@example.com",
                id: "user_1",
                name: null,
              },
            },
            ok: true,
          }),
          { status: 200 },
        );
      },
    });

    await api.getMe("token_123");

    expect(urls[0]).toBe("https://opco.test/api/v1/me");
  });

  it("times out hanging requests as network errors", async () => {
    vi.useFakeTimers();
    const diagnostics = vi.fn();

    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
          });
        }),
      onRequestDiagnostics: diagnostics,
      timeoutMs: 10,
    });

    const request = api.getMe("token_123");
    const expectation = expect(request).rejects.toBeInstanceOf(OpcoNetworkError);

    await vi.advanceTimersByTimeAsync(10);
    await expectation;
    await expect(request).rejects.toMatchObject({
      diagnostics: {
        abortControllerTriggered: true,
        fetchResolvedAt: null,
        httpStatus: null,
        method: "GET",
        pathTemplate: "/api/v1/me",
        responseStarted: false,
        timeoutMs: 10,
      },
    });
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({
      abortControllerTriggered: true,
      fetchResolvedAt: null,
      httpStatus: null,
      pathTemplate: "/api/v1/me",
      responseStarted: false,
    }));
  });

  it("reports sanitized request timing diagnostics for successful state-update POSTs", async () => {
    const diagnostics = vi.fn();
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async () =>
        jsonResponse({
          data: {
            appView: { id: "view_1", name: "Asistencia", slug: "asistencia" },
            result: {
              recordId: "record_1",
              result: "CREATED",
              subjectRecordId: "person_1",
              updatedAt: "2026-08-28T12:00:00.000Z",
            },
          },
          ok: true,
        }),
      onRequestDiagnostics: diagnostics,
    });

    await api.saveStateUpdateWorkflow("token_123", "contract_secret", "view_secret", {
      clientRequestId: "client_request_secret",
      stateValues: [{ fieldId: "status_field", optionId: "present_option" }],
      subjectRecordId: "person_1",
    });

    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({
      abortControllerTriggered: false,
      httpStatus: 200,
      method: "POST",
      pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update",
      responseStarted: true,
    }));
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("contract_secret");
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("view_secret");
  });

  it("parses paginated entity records and sends search query params", async () => {
    const urls: string[] = [];
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (url) => {
        urls.push(String(url));

        return new Response(
          JSON.stringify({
            data: {
              pagination: {
                page: 1,
                pageSize: 25,
                total: 1,
                totalPages: 1,
              },
              records: [entityRecordFixture],
            },
            ok: true,
          }),
          { status: 200 },
        );
      },
    });

    const result = await api.getEntityRecords("token_123", "contract_1", "entity_1", {
      page: 1,
      pageSize: 25,
      search: " EQ ",
    });

    expect(urls[0]).toBe(
      "https://opco.test/api/v1/contracts/contract_1/entities/entity_1/records?page=1&pageSize=25&search=EQ",
    );
    expect(result.records).toEqual([entityRecordFixture]);
    expect(result.pagination.total).toBe(1);
  });

  it("parses assigned app views for a contract", async () => {
    const urls: string[] = [];
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (url) => {
        urls.push(String(url));

        return new Response(
          JSON.stringify({
            data: {
              views: appViewsFixture,
            },
            ok: true,
          }),
          { status: 200 },
        );
      },
    });

    const result = await api.getAppViews("token_123", "contract_1");

    expect(urls[0]).toBe("https://opco.test/api/v1/contracts/contract_1/views");
    expect(result.views[0].type).toBe("RECORDS");
    if (result.views[0].type !== "RECORDS") {
      throw new Error("Expected first fixture view to be RECORDS.");
    }
    expect(result.views[0].config.entityTypeId).toBe("entity_1");
    expect(result.views.map((view) => view.type)).toEqual(["RECORDS", "WORKFLOW", "BOARD", "DASHBOARD"]);
  });

  it("parses users without assigned app views", async () => {
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async () =>
        new Response(
          JSON.stringify({
            data: {
              views: [],
            },
            ok: true,
          }),
          { status: 200 },
        ),
    });

    await expect(api.getAppViews("token_123", "contract_1")).resolves.toEqual({ views: [] });
  });

  it("loads attendance workflow state for one local date and optional person search", async () => {
    const urls: string[] = [];
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (url) => {
        urls.push(String(url));

        return jsonResponse({
          data: {
            appView: { id: "view_attendance", name: "Tomar asistencia", slug: "tomar-asistencia" },
            date: "2026-08-22",
            items: [
              {
                attendance: {
                  observation: null,
                  recordId: "attendance_1",
                  statusLabel: "Presente",
                  statusOptionId: "present_option",
                  updatedAt: "2026-08-22T12:00:00.000Z",
                },
                person: { displayName: "Ana Perez", id: "person_1" },
              },
              {
                attendance: null,
                person: { displayName: "Juan Soto", id: "person_2" },
              },
            ],
            latest: [
              {
                attendanceRecordId: "attendance_1",
                person: { displayName: "Ana Perez", id: "person_1" },
                statusLabel: "Presente",
                statusOptionId: "present_option",
                updatedAt: "2026-08-22T12:00:00.000Z",
              },
            ],
            sourceEntityType: { id: "entity_people", name: "Personas" },
            statuses: [
              { isDefaultCheckIn: true, label: "Presente", optionId: "present_option" },
              { isDefaultCheckIn: false, label: "Atraso", optionId: "late_option" },
            ],
            summary: { totalRegistered: 18 },
            targetEntityType: { id: "entity_attendance", name: "Asistencias" },
          },
          ok: true,
        });
      },
    });

    const result = await api.getAttendanceWorkflow("token_123", "contract_1", "view_attendance", {
      date: "2026-08-22",
      personRecordId: "person_1",
      search: " ana ",
    });

    expect(urls[0]).toBe(
      "https://opco.test/api/v1/contracts/contract_1/views/view_attendance/workflow/attendance?date=2026-08-22&search=ana&personRecordId=person_1",
    );
    expect(result.statuses).toEqual([
      { isDefaultCheckIn: true, label: "Presente", optionId: "present_option" },
      { isDefaultCheckIn: false, label: "Atraso", optionId: "late_option" },
    ]);
    expect(result.summary.totalRegistered).toBe(18);
    expect(result.latest[0].statusOptionId).toBe("present_option");
    expect(result.items[0].attendance?.statusOptionId).toBe("present_option");
    expect(result.items[1].attendance).toBeNull();
  });

  it("maps attendance stateFields options when the backend returns the state-update preset shape", async () => {
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async () => jsonResponse({
        data: {
          appView: { id: "view_attendance", name: "Tomar asistencia", slug: "tomar-asistencia" },
          date: "2026-08-22",
          items: [
            {
              attendance: null,
              person: { displayName: "Ana Perez", id: "person_1" },
            },
          ],
          latest: [],
          sourceEntityType: { id: "entity_people", name: "Personas" },
          stateFields: [
            {
              defaultOptionId: "late_option",
              fieldId: "field_attendance_status",
              label: "Estado",
              options: [
                { label: "Presente", optionId: "present_option" },
                { label: "Ausente", optionId: "absent_option" },
                { label: "Atraso", optionId: "late_option" },
              ],
              required: true,
            },
          ],
          statuses: [],
          summary: { totalRegistered: 0 },
          targetEntityType: { id: "entity_attendance", name: "Asistencias" },
        },
        ok: true,
      }),
    });

    const result = await api.getAttendanceWorkflow("token_123", "contract_1", "view_attendance", {
      date: "2026-08-22",
    });

    expect(result.statuses).toEqual([
      { isDefaultCheckIn: false, label: "Presente", optionId: "present_option" },
      { isDefaultCheckIn: false, label: "Ausente", optionId: "absent_option" },
      { isDefaultCheckIn: true, label: "Atraso", optionId: "late_option" },
    ]);
    expect(result.statuses).toHaveLength(3);
  });

  it("saves one attendance entry with statusOptionId", async () => {
    const requests: RequestInit[] = [];
    const urls: string[] = [];
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (url, init) => {
        urls.push(String(url));
        requests.push(init ?? {});

        return jsonResponse({
          data: {
            appView: { id: "view_attendance", name: "Tomar asistencia", slug: "tomar-asistencia" },
            date: "2026-08-22",
            results: [{ personRecordId: "person_1", recordId: "attendance_1", result: "CREATED" }],
          },
          ok: true,
        });
      },
    });

    const result = await api.saveAttendanceWorkflow("token_123", "contract_1", "view_attendance", {
      clientRequestId: "request_1",
      date: "2026-08-22",
      entries: [{ observation: "Turno AM", personRecordId: "person_1", statusOptionId: "present_option" }],
    });

    expect(urls[0]).toBe("https://opco.test/api/v1/contracts/contract_1/views/view_attendance/workflow/attendance");
    expect(requests[0].method).toBe("POST");
    expect(JSON.parse(String(requests[0].body))).toEqual({
      clientRequestId: "request_1",
      date: "2026-08-22",
      entries: [{ observation: "Turno AM", personRecordId: "person_1", statusOptionId: "present_option" }],
    });
    expect(result.results[0]).toMatchObject({ result: "CREATED" });
  });

  it("loads generic state-update workflow state", async () => {
    const urls: string[] = [];
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (url) => {
        urls.push(String(url));

        return jsonResponse({
          data: {
            appView: { id: "view_state", name: "Estados", slug: "estados" },
            date: "2026-08-22",
            dateFieldId: "field_date",
            extraFields: [],
            historyMode: "update-current",
            items: [
              {
                current: {
                  recordId: "event_1",
                  stateValues: [{ fieldId: "field_status", label: "Disponible", optionId: "available" }],
                  updatedAt: "2026-08-22T12:00:00.000Z",
                },
                subject: { displayName: "Equipo 1", id: "asset_1" },
              },
            ],
            latest: [
              {
                recordId: "event_1",
                stateValues: [{ fieldId: "field_status", label: "Disponible", optionId: "available" }],
                subject: { displayName: "Equipo 1", id: "asset_1" },
                updatedAt: "2026-08-22T12:00:00.000Z",
              },
            ],
            sourceEntityType: { id: "assets", name: "Activos" },
            stateFields: [
              {
                fieldId: "field_status",
                label: "Estado",
                options: [{ label: "Disponible", optionId: "available" }],
                required: true,
              },
            ],
            subjectFieldId: "field_asset",
            summary: { totalRegistered: 1 },
            targetEntityType: { id: "events", name: "Eventos" },
            uniqueness: "subject-date",
          },
          ok: true,
        });
      },
    });

    const result = await api.getStateUpdateWorkflow("token_123", "contract_1", "view_state", {
      date: "2026-08-22",
      search: " equipo ",
      subjectRecordId: "asset_1",
    });

    expect(urls[0]).toBe(
      "https://opco.test/api/v1/contracts/contract_1/views/view_state/workflow/state-update?date=2026-08-22&search=equipo&subjectRecordId=asset_1",
    );
    expect(result.stateFields[0].fieldId).toBe("field_status");
    expect(result.items[0].current?.stateValues[0].optionId).toBe("available");
    expect(result.summary?.totalRegistered).toBe(1);
  });

  it("rejects state-update latest snapshots without authoritative updatedAt", async () => {
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async () =>
        jsonResponse({
          data: {
            appView: { id: "view_state", name: "Estados", slug: "estados" },
            extraFields: [],
            historyMode: "update-current",
            items: [],
            latest: [
              {
                recordId: "event_1",
                stateValues: [{ fieldId: "field_status", label: "Disponible", optionId: "available" }],
                subject: { displayName: "Equipo 1", id: "asset_1" },
              },
            ],
            sourceEntityType: { id: "assets", name: "Activos" },
            stateFields: [],
            subjectFieldId: "field_asset",
            targetEntityType: { id: "events", name: "Eventos" },
            uniqueness: "subject-date",
          },
          ok: true,
        }),
    });

    await expect(api.getStateUpdateWorkflow("token_123", "contract_1", "view_state"))
      .rejects.toMatchObject({ code: "INVALID_RECORD_UPDATED_AT" });
  });

  it("saves generic state-update entries with multiple state fields and extra values", async () => {
    const requests: RequestInit[] = [];
    const urls: string[] = [];
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (url, init) => {
        urls.push(String(url));
        requests.push(init ?? {});

        return jsonResponse({
          data: {
            appView: { id: "view_state", name: "Estados", slug: "estados" },
            result: { recordId: "event_1", result: "UPDATED", subjectRecordId: "asset_1", updatedAt: "2026-08-22T12:00:00.000Z" },
          },
          ok: true,
        });
      },
    });

    const result = await api.saveStateUpdateWorkflow("token_123", "contract_1", "view_state", {
      clientRequestId: "request_1",
      date: "2026-08-22",
      extraValues: { note: "Turno AM" },
      stateValues: [
        { fieldId: "field_operational", optionId: "running" },
        { fieldId: "field_maintenance", optionId: "ok" },
      ],
      subjectRecordId: "asset_1",
    });

    expect(urls[0]).toBe("https://opco.test/api/v1/contracts/contract_1/views/view_state/workflow/state-update");
    expect(requests[0].method).toBe("POST");
    expect(JSON.parse(String(requests[0].body))).toEqual({
      clientRequestId: "request_1",
      date: "2026-08-22",
      extraValues: { note: "Turno AM" },
      states: {
        field_maintenance: "ok",
        field_operational: "running",
      },
      subjectRecordId: "asset_1",
    });
    expect(result.results[0]).toMatchObject({ result: "UPDATED", updatedAt: "2026-08-22T12:00:00.000Z" });
  });

  it("rejects successful state-update results without authoritative updatedAt", async () => {
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async () =>
        jsonResponse({
          data: {
            appView: { id: "view_state", name: "Estados", slug: "estados" },
            result: { recordId: "event_1", result: "UPDATED", subjectRecordId: "asset_1" },
          },
          ok: true,
        }),
    });

    await expect(api.saveStateUpdateWorkflow("token_123", "contract_1", "view_state", {
      clientRequestId: "request_1",
      stateValues: [{ fieldId: "field_operational", optionId: "running" }],
      subjectRecordId: "asset_1",
    })).rejects.toMatchObject({ code: "INVALID_RECORD_UPDATED_AT" });
  });

  it("normalizes backend state-update conflict differences to generic stateValues", async () => {
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async () =>
        jsonResponse({
          data: {
            appView: { id: "view_state", name: "Estados", slug: "estados" },
            result: {
              differences: [{
                existingLabel: "Detenido",
                existingOptionId: "stopped",
                fieldId: "field_operational",
                requestedLabel: "Operando",
                requestedOptionId: "running",
              }],
              existing: {
                recordId: "event_1",
                updatedAt: "2026-08-22T12:00:00.000Z",
              },
              requested: { states: { field_operational: "running" } },
              result: "CONFLICT",
              subjectRecordId: "asset_1",
            },
          },
          ok: true,
        }),
    });

    const result = await api.saveStateUpdateWorkflow("token_123", "contract_1", "view_state", {
      date: "2026-08-22",
      stateValues: [{ fieldId: "field_operational", optionId: "running" }],
      subjectRecordId: "asset_1",
    });

    expect(result.results[0]).toMatchObject({
      existing: {
        stateValues: [{ fieldId: "field_operational", label: "Detenido", optionId: "stopped" }],
      },
      requested: {
        stateValues: [{ fieldId: "field_operational", label: "Operando", optionId: "running" }],
      },
      result: "CONFLICT",
    });
  });

  it("parses attendance conflicts with expected overwrite data", async () => {
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async () =>
        jsonResponse({
          data: {
            appView: { id: "view_attendance", name: "Tomar asistencia", slug: "tomar-asistencia" },
            date: "2026-08-22",
            results: [
              {
                existing: {
                  recordId: "attendance_1",
                  statusLabel: "Presente",
                  statusOptionId: "present_option",
                  updatedAt: "2026-08-22T12:00:00.000Z",
                },
                personRecordId: "person_1",
                requested: {
                  statusLabel: "Atraso",
                  statusOptionId: "late_option",
                },
                result: "CONFLICT",
              },
            ],
          },
          ok: true,
        }),
    });

    const result = await api.saveAttendanceWorkflow("token_123", "contract_1", "view_attendance", {
      date: "2026-08-22",
      entries: [{ personRecordId: "person_1", statusOptionId: "late_option" }],
    });

    expect(result.results[0]).toMatchObject({
      existing: {
        statusLabel: "Presente",
        statusOptionId: "present_option",
        updatedAt: "2026-08-22T12:00:00.000Z",
      },
      requested: { statusLabel: "Atraso", statusOptionId: "late_option" },
      result: "CONFLICT",
    });
  });

  it("parses one entity record detail", async () => {
    const urls: string[] = [];
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (url) => {
        urls.push(String(url));

        return new Response(
          JSON.stringify({
            data: {
              record: entityRecordFixture,
            },
            ok: true,
          }),
          { status: 200 },
        );
      },
    });

    const result = await api.getEntityRecord("token_123", "contract_1", "entity_1", "record_1");

    expect(urls[0]).toBe("https://opco.test/api/v1/contracts/contract_1/entities/entity_1/records/record_1");
    expect(result.record).toEqual(entityRecordFixture);
  });

  it("rejects entity records without ISO updatedAt", async () => {
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async () =>
        new Response(
          JSON.stringify({
            data: {
              record: {
                ...entityRecordFixture,
                updatedAt: "not-a-date",
              },
            },
            ok: true,
          }),
          { status: 200 },
        ),
    });

    await expect(api.getEntityRecord("token_123", "contract_1", "entity_1", "record_1")).rejects.toMatchObject({
      code: "INVALID_RECORD_UPDATED_AT",
    });
  });

  it("creates entity records with a client request id", async () => {
    const requests: RequestInit[] = [];
    const urls: string[] = [];
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (url, init) => {
        urls.push(String(url));
        requests.push(init ?? {});

        return new Response(
          JSON.stringify({
            data: {
              record: entityRecordFixture,
            },
            ok: true,
          }),
          { status: 200 },
        );
      },
    });

    await api.createEntityRecord("token_123", "contract_1", "entity_1", {
      clientRequestId: "request_1",
      values: {
        codigo: "EQ-002",
      },
    });

    expect(urls[0]).toBe("https://opco.test/api/v1/contracts/contract_1/entities/entity_1/records");
    expect(requests[0].method).toBe("POST");
    expect(JSON.parse(String(requests[0].body))).toEqual({
      clientRequestId: "request_1",
      values: {
        codigo: "EQ-002",
      },
    });
  });

  it("updates entity records partially", async () => {
    const requests: RequestInit[] = [];
    const urls: string[] = [];
    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (url, init) => {
        urls.push(String(url));
        requests.push(init ?? {});

        return new Response(
          JSON.stringify({
            data: {
              record: entityRecordFixture,
            },
            ok: true,
          }),
          { status: 200 },
        );
      },
    });

    await api.updateEntityRecord("token_123", "contract_1", "entity_1", "record_1", {
      values: {
        estado: "operativo",
      },
    });

    expect(urls[0]).toBe("https://opco.test/api/v1/contracts/contract_1/entities/entity_1/records/record_1");
    expect(requests[0].method).toBe("PATCH");
    expect(JSON.parse(String(requests[0].body))).toEqual({
      values: {
        estado: "operativo",
      },
    });
  });
});
