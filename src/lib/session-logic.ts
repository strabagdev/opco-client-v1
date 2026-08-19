import { OpcoApiError, MeResponse } from "./opco-api";

export type TokenStore = {
  clearSession(): Promise<void>;
  getAccessToken(): Promise<string | null>;
};

export type RestoreSessionResult =
  | {
      status: "anonymous";
    }
  | {
      status: "authenticated";
      token: string;
      me: MeResponse;
    }
  | {
      status: "offline";
      token: string;
    };

export async function restoreSession(
  tokenStore: TokenStore,
  api: { getMe(token: string): Promise<MeResponse> },
): Promise<RestoreSessionResult> {
  const token = await tokenStore.getAccessToken();

  if (!token) {
    return { status: "anonymous" };
  }

  try {
    const me = await api.getMe(token);
    const currentToken = (await tokenStore.getAccessToken()) ?? token;

    return {
      me,
      status: "authenticated",
      token: currentToken,
    };
  } catch (error) {
    if (error instanceof OpcoApiError && error.status === 401) {
      await tokenStore.clearSession();
      return { status: "anonymous" };
    }

    return {
      status: "offline",
      token,
    };
  }
}
