import { z } from "zod";

export const LoginRequest = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(1000),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export type MeResponse = { userId: string; username: string };

export type ApiErrorCode =
  | "bad_request"
  | "unsupported_media_type"
  | "forbidden_origin"
  | "unauthorized"
  | "invalid_credentials"
  | "too_many_attempts"
  | "auth_not_configured"
  | "not_found";

export type ApiErrorBody = { error: ApiErrorCode; retryAfterSec?: number };
