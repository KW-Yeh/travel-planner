import { expect, type Page } from "@playwright/test";
import { TEST_PASSWORD, TEST_USERNAME } from "../fixtures/credentials";

export async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("帳號").fill(TEST_USERNAME);
  await page.getByLabel("密碼").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByRole("heading", { name: "我的旅程" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("已同步到雲端");
}

export async function signOut(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "設定" }).click();
  await page.getByRole("button", { name: "登出並清除這台裝置的資料" }).click();
  await expect(page.getByLabel("帳號")).toBeVisible();
}

/** Makes every API call fail as if the network were down, while the page itself still loads. */
export async function cutApi(page: Page): Promise<void> {
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
}

export function localMeta(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("travel-planner");
        open.onerror = () => {
          reject(new Error("open failed"));
        };
        open.onsuccess = () => {
          const req = open.result.transaction("meta").objectStore("meta").getAllKeys();
          req.onsuccess = () => {
            resolve(req.result.map(String));
            open.result.close();
          };
        };
      }),
  );
}

export async function createTrip(page: Page, name: string, start: string, end: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: "建立旅程" }).click();
  await page.getByLabel("旅程名稱").fill(name);
  await page.getByLabel("開始日期").fill(start);
  await page.getByLabel("結束日期").fill(end);
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

export async function addStop(page: Page, name: string, opts: { kind?: string; stay?: string } = {}): Promise<void> {
  await page.getByRole("link", { name: "新增地點" }).click();
  await page.getByLabel("地點名稱").fill(name);
  if (opts.kind) await page.getByRole("button", { name: opts.kind, exact: true }).click();
  if (opts.stay) await page.getByLabel("停留時間").selectOption({ label: opts.stay });
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
}

/** Sets the n-th (0-based) leg of the visible day to a manual time. */
export async function setLegMinutes(page: Page, index: number, minutes: number, mode?: string): Promise<void> {
  await page.locator('main a[href*="/legs/"]').nth(index).click();
  if (mode) await page.getByRole("button", { name: mode }).click();
  await page.getByLabel("交通時間（分鐘）").fill(String(minutes));
  await page.getByRole("button", { name: "套用" }).click();
}

/** Arrival times shown down the left edge of the timeline, in order. */
export async function shownTimes(page: Page): Promise<string[]> {
  const main = page.getByRole("main");
  return (await main.locator("[class*='stopRow'] > span:first-child").allTextContents()).map((t) => t.trim());
}
