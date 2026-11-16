import { expect, test } from "@playwright/test";
import { TEST_USERNAME } from "../fixtures/credentials";
import { cutApi, localMeta, signIn } from "./helpers";

test("opens on local data when the server is unreachable", async ({ page }) => {
  await signIn(page);
  expect(await localMeta(page)).toEqual(expect.arrayContaining(["user", "syncCursor"]));

  await cutApi(page);
  await page.reload();
  await expect(page.getByText(`已登入：${TEST_USERNAME}`)).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("離線，顯示本機資料");
});

test("logout needs the network and then wipes local data", async ({ page }) => {
  await signIn(page);

  await cutApi(page);
  await page.getByRole("button", { name: "登出" }).click();
  await expect(page.getByRole("alert")).toHaveText("需要連線才能登出。");

  await page.unroute("**/api/**");
  await page.getByRole("button", { name: "登出" }).click();
  await expect(page.getByLabel("帳號")).toBeVisible();
  expect(await localMeta(page)).toEqual([]);
});
