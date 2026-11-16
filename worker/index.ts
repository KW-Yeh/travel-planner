import { Hono } from "hono";
import { authRoutes } from "./auth/routes";
import { apiError } from "./http";
import { requireSession, sameOrigin } from "./middleware";
import { syncRoutes } from "./sync/routes";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", sameOrigin, requireSession);

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", authRoutes);
app.route("/sync", syncRoutes);

app.notFound((c) => apiError(c, 404, "not_found"));

export default app;
