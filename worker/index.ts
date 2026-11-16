import { Hono } from "hono";
import { attachmentRoutes } from "./attachments/routes";
import { authRoutes } from "./auth/routes";
import { apiError } from "./http";
import { requireSession, sameOrigin } from "./middleware";
import { linkRoutes } from "./routes/links";
import { configRoute, routeRoutes } from "./routes/routes";
import { syncRoutes } from "./sync/routes";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", sameOrigin, requireSession);

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", authRoutes);
app.route("/sync", syncRoutes);
app.route("/attachments", attachmentRoutes);
app.route("/routes", routeRoutes);
app.route("/config", configRoute);
app.route("/links", linkRoutes);

app.notFound((c) => apiError(c, 404, "not_found"));

export default app;
