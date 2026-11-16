import { expect, test, type Page } from "@playwright/test";
import { TEST_PASSWORD, TEST_USERNAME } from "../fixtures/credentials";

async function fillLogin(page: Page, username: string, password: string) {
  await page.getByLabel("帳號").fill(username);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
}

test("shows an error for a wrong password, then signs in and stays signed in", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByRole("alert")).toHaveText("請輸入帳號和密碼。");

  await fillLogin(page, TEST_USERNAME, "definitely-wrong");
  await expect(page.getByRole("alert")).toHaveText("帳號或密碼不正確。");
  await expect(page.getByLabel("密碼")).toHaveValue("");

  await fillLogin(page, TEST_USERNAME, TEST_PASSWORD);
  await expect(page.getByText(`已登入：${TEST_USERNAME}`)).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("已同步到雲端");

  const [cookie] = (await context.cookies()).filter((c) => c.name === "__Host-tp_session");
  expect(cookie).toBeDefined();
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.secure).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  const days = ((cookie?.expires ?? 0) * 1000 - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(29.9);
  expect(days).toBeLessThanOrEqual(30);

  await page.reload();
  await expect(page.getByText(`已登入：${TEST_USERNAME}`)).toBeVisible();

  await page.getByRole("button", { name: "登出" }).click();
  await expect(page.getByLabel("帳號")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("帳號")).toBeVisible();
});

test("shows the lock countdown after repeated failures", async ({ page }) => {
  await page.goto("/");
  for (let i = 0; i < 5; i++) {
    await fillLogin(page, TEST_USERNAME, `wrong-${i}`);
    await expect(page.getByRole("alert")).toBeVisible();
  }
  await expect(page.getByRole("alert")).toContainText("嘗試次數過多，已暫時鎖定。");
  await expect(page.getByRole("alert")).toContainText(/鎖定。請在 1[45] 分/);
  await page.getByLabel("密碼").fill(TEST_PASSWORD);
  await expect(page.getByRole("button", { name: "暫時鎖定中" })).toBeDisabled();
});

test("offers a retry when the server cannot be reached", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.abort("internetdisconnected"));
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("目前沒有網路連線");
  await page.unroute("**/api/auth/me");
  await page.getByRole("button", { name: "重試" }).click();
  await expect(page.getByLabel("帳號")).toBeVisible();
});
