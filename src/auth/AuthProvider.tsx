import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LoginRequest, MeResponse } from "../../shared/api";
import { ApiError, NetworkError, apiRequest } from "../api/client";

export type AuthState =
  | { status: "checking" }
  | { status: "signedOut" }
  | { status: "offline" }
  | { status: "signedIn"; user: MeResponse };

type AuthContextValue = {
  state: AuthState;
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<AuthState> {
  try {
    return { status: "signedIn", user: await apiRequest<MeResponse>("/api/auth/me") };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { status: "signedOut" };
    if (error instanceof NetworkError) return { status: "offline" };
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchMe().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const login = useCallback(async (credentials: LoginRequest) => {
    await apiRequest("/api/auth/login", { json: credentials });
    setState(await fetchMe());
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } catch (error) {
      // An already-expired session is still a successful logout from the user's view.
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    setState({ status: "signedOut" });
  }, []);

  const retry = useCallback(() => {
    setState({ status: "checking" });
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo(() => ({ state, login, logout, retry }), [state, login, logout, retry]);
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
