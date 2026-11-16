import { expect, test } from "@playwright/test";
import { createTrip, cutApi, localMeta, signIn } from "./helpers";

test("opens on local data when the server is unreachable", async ({ page }) => {
  await signIn(page);
  await createTrip(page, "離線測試", "2027-05-01", "2027-05-02");
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("已同步到雲端");
  expect(await localMeta(page)).toEqual(expect.arrayContaining(["user", "syncCursor"]));

  await cutApi(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "離線測試" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("離線，顯示本機資料");
});

test("logout needs the network and then wipes local data", async ({ page }) => {
  await signIn(page);

  await cutApi(page);
  await page.getByRole("button", { name: "設定" }).click();
  await page.getByRole("button", { name: "登出並清除這台裝置的資料" }).click();
  await expect(page.getByRole("alert")).toHaveText("需要連線才能登出。");

  await page.unroute("**/api/**");
  await page.getByRole("button", { name: "登出並清除這台裝置的資料" }).click();
  await expect(page.getByLabel("帳號")).toBeVisible();
  expect(await localMeta(page)).toEqual([]);
});
