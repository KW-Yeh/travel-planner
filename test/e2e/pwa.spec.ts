import { expect, test, type Page } from "@playwright/test";
import { addStop, createTrip, signIn } from "./helpers";

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

test.describe("installed app", () => {
  test.use({ serviceWorkers: "allow" });

  test("is installable and reopens fully offline with editable local data", async ({ page, context }) => {
    await signIn(page);
    await createTrip(page, "離線旅程", "2027-04-02", "2027-04-02");
    await addStop(page, "金閣寺");

    const manifest = await page.evaluate(async () => {
      const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
      return href ? ((await (await fetch(href)).json()) as { display: string; icons: { sizes: string; purpose?: string }[] }) : null;
    });
    expect(manifest?.display).toBe("standalone");
    expect(manifest?.icons.map((i) => `${i.sizes}${i.purpose ? `/${i.purpose}` : ""}`)).toEqual(["192x192", "512x512", "512x512/maskable"]);

    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // The first load is not yet controlled; one reload puts the page under the service worker.
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    await context.setOffline(true);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "離線旅程" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("離線，顯示本機資料");

    await page.getByRole("heading", { name: "離線旅程" }).click();
    await addStop(page, "銀閣寺");
    await expect(page.getByRole("link", { name: /銀閣寺/ })).toBeVisible();

    await page.getByRole("navigation").getByRole("link", { name: "地圖" }).click();
    await expect(page.getByRole("region", { name: "地點清單" }).getByRole("button", { name: /銀閣寺/ })).toBeVisible();

    await context.setOffline(false);
  });
});

test("reduced motion turns animations and transitions off", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await createTrip(page, "動態", "2027-04-02", "2027-04-02");
  await addStop(page, "金閣寺");
  const moving = await page.evaluate(() =>
    [...document.querySelectorAll("*")].filter((el) => {
      const s = getComputedStyle(el);
      return s.animationName !== "none" || (s.transitionDuration.split(",").some((d) => parseFloat(d) > 0) && s.transitionProperty !== "none");
    }).length,
  );
  expect(moving).toBe(0);
});

for (const width of [375, 390, 768]) {
  test(`no horizontal scrolling at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await signIn(page);
    await createTrip(page, "寬度檢查一個很長很長很長的旅程名稱", "2027-04-02", "2027-04-03");
    await addStop(page, "一個名稱非常非常非常非常非常長的地點，用來檢查換行");
    expect(await hasHorizontalScroll(page)).toBe(false);
    await page.getByRole("link", { name: "新增地點" }).click();
    expect(await hasHorizontalScroll(page)).toBe(false);
    await page.getByRole("link", { name: "取消" }).click();
    await page.getByRole("navigation").getByRole("link", { name: "地圖" }).click();
    expect(await hasHorizontalScroll(page)).toBe(false);
    await page.getByRole("navigation").getByRole("link", { name: "訂位" }).click();
    expect(await hasHorizontalScroll(page)).toBe(false);
    await page.goto("/");
    expect(await hasHorizontalScroll(page)).toBe(false);
  });
}
