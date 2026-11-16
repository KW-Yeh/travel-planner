import { Hono } from "hono";
import { authRoutes } from "./auth/routes";
import { apiError } from "./http";
import { requireSession, sameOrigin } from "./middleware";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", sameOrigin, requireSession);

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", authRoutes);

app.notFound((c) => apiError(c, 404, "not_found"));

export default app;
