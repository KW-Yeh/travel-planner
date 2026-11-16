import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiErrorBody, ApiErrorCode } from "../shared/api";

export function apiError(c: Context, status: ContentfulStatusCode, error: ApiErrorCode, extra?: Omit<ApiErrorBody, "error">) {
  return c.json<ApiErrorBody>({ error, ...extra }, status);
}

export function tooManyAttempts(c: Context, retryAfterMs: number) {
  const retryAfterSec = Math.ceil(retryAfterMs / 1000);
  c.header("Retry-After", String(retryAfterSec));
  return apiError(c, 429, "too_many_attempts", { retryAfterSec });
}

/** Parses a JSON body, or returns the error response to send. */
export async function readJson(c: Context): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  if (!c.req.header("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return { ok: false, response: apiError(c, 415, "unsupported_media_type") };
  }
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false, response: apiError(c, 400, "bad_request") };
  }
}
