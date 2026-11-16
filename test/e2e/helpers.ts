import { expect, type Page } from "@playwright/test";
import { TEST_PASSWORD, TEST_USERNAME } from "../fixtures/credentials";

export async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("帳號").fill(TEST_USERNAME);
  await page.getByLabel("密碼").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByRole("status")).toHaveText("已同步到雲端");
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
