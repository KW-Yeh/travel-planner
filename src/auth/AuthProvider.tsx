import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LoginRequest, MeResponse } from "../../shared/api";
import { ApiError, NetworkError, apiRequest } from "../api/client";
import { clearLocalData, db } from "../db/db";
import { onSyncUnauthorized, syncEngine } from "../sync/instance";

export type AuthState =
  | { status: "checking" }
  | { status: "signedOut" }
  | { status: "offline" }
  | { status: "signedIn"; user: MeResponse };

type AuthContextValue = {
  state: AuthState;
  login: (credentials: LoginRequest) => Promise<void>;
  /** Ends the session and erases local data. Fails while offline: the server must forget the session too. */
  logout: () => Promise<void>;
  retry: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const USER_KEY = "user";

/** Remembers who owns the local data; another account signing in on this device starts from empty. */
async function adoptUser(user: MeResponse): Promise<void> {
  const previous = await db.getMeta<MeResponse>(USER_KEY);
  if (previous && previous.userId !== user.userId) await clearLocalData();
  await db.setMeta(USER_KEY, user);
}

async function resolveAuth(): Promise<AuthState> {
  try {
    const user = await apiRequest<MeResponse>("/api/auth/me");
    await adoptUser(user);
    return { status: "signedIn", user };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { status: "signedOut" };
    if (error instanceof NetworkError) {
      // A device that signed in before keeps working offline on its local data.
      const known = await db.getMeta<MeResponse>(USER_KEY);
      return known ? { status: "signedIn", user: known } : { status: "offline" };
    }
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void resolveAuth().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(
    () =>
      onSyncUnauthorized(() => {
        setState({ status: "signedOut" });
      }),
    [],
  );

  const signedIn = state.status === "signedIn";
  useEffect(() => {
    if (!signedIn) return;
    syncEngine.start();
    return () => {
      syncEngine.stop();
    };
  }, [signedIn]);

  const login = useCallback(async (credentials: LoginRequest) => {
    await apiRequest("/api/auth/login", { json: credentials });
    setState(await resolveAuth());
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    syncEngine.stop();
    await clearLocalData();
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
