import { expect, test } from "@playwright/test";

test("serves the app shell and the API from one Worker", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "旅程規劃" })).toBeVisible();

  await page.goto("/trips/some-deep-link");
  await expect(page.getByRole("heading", { name: "旅程規劃" })).toBeVisible();

  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);

  const protectedRoute = await request.get("/api/auth/me");
  expect(protectedRoute.status()).toBe(401);
});
