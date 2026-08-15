import { afterEach, describe, expect, it, vi } from "vitest";

import { createOpcoApi, OpcoApiError, OpcoNetworkError, parseApiEnvelope } from "./opco-api";
import { entityRecordFixture } from "../test/fixtures";

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

    const api = createOpcoApi({
      apiUrl: "https://opco.test",
      clientId: "opco_app_123",
      fetcher: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
          });
        }),
      timeoutMs: 10,
    });

    const request = api.getMe("token_123");
    const expectation = expect(request).rejects.toBeInstanceOf(OpcoNetworkError);

    await vi.advanceTimersByTimeAsync(10);
    await expectation;
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
});
