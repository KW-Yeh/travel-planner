import type { ResolvedSession } from "./auth/session";

export type AppEnv = {
  Bindings: Env;
  Variables: { session: ResolvedSession };
};
