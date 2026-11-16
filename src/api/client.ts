import type { ApiErrorBody, ApiErrorCode } from "../../shared/api";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | "unknown";
  readonly retryAfterSec: number | undefined;

  constructor(status: number, code: ApiErrorCode | "unknown", retryAfterSec?: number) {
    super(`API ${status} ${code}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

/** The request never reached the server (offline, DNS, CORS, aborted). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("Network request failed", { cause });
    this.name = "NetworkError";
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {};
  try {
    body = (await res.json()) as Partial<ApiErrorBody>;
  } catch {
    // Non-JSON error page (e.g. a proxy); fall through to "unknown".
  }
  return new ApiError(res.status, body.error ?? "unknown", body.retryAfterSec);
}

export async function apiRequest<T = undefined>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const request: RequestInit = {
    method: init.method ?? (init.json === undefined ? "GET" : "POST"),
    credentials: "same-origin",
  };
  if (init.json !== undefined) {
    request.headers = { "Content-Type": "application/json" };
    request.body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(path, request);
  } catch (error) {
    throw new NetworkError(error);
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
