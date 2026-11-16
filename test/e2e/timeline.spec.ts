import { expect, test } from "@playwright/test";
import { addStop, createTrip, pickStay, setLegMinutes, shownTimes, signIn } from "./helpers";

test("builds a day, pushes times on change and flags a fixed time it cannot reach", async ({ page }) => {
  await signIn(page);
  await createTrip(page, "京都 3 日", "2027-03-26", "2027-03-28");
  await expect(page.getByRole("button", { name: /Day 1/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /Day 3/ })).toBeVisible();

  await page.getByLabel("當日出發時間").fill("09:12");
  await addStop(page, "京都車站", { kind: "交通" });
  await addStop(page, "伏見稻荷大社", { stay: "1 小時 45 分" });
  await addStop(page, "清水寺", { stay: "2 小時" });

  await setLegMinutes(page, 0, 8, "大眾運輸");
  await setLegMinutes(page, 1, 32);
  await expect.poll(() => shownTimes(page)).toEqual(["09:12", "09:20", "11:37"]);
  await expect(page.getByText("3 個地點 · 交通共 40 分")).toBeVisible();

  await page.getByRole("link", { name: /伏見稻荷大社/ }).click();
  await pickStay(page, "1 小時");
  await page.getByRole("button", { name: "儲存" }).click();
  await expect.poll(() => shownTimes(page)).toEqual(["09:12", "09:20", "10:52"]);

  await page.getByRole("link", { name: /清水寺/ }).click();
  await page.getByRole("switch", { name: "固定抵達時間" }).click();
  await page.getByLabel("抵達時刻").fill("10:30");
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByText("排不進固定時間，預計晚 22 分抵達")).toBeVisible();
  await expect.poll(() => shownTimes(page)).toEqual(["09:12", "09:20", "10:30"]);

  await page.goto("/");
  await expect(page.getByText("Day 1 有 1 則時間衝突")).toBeVisible();
});

test("reorders stops and restores a leg's time when moved back", async ({ page }) => {
  await signIn(page);
  await createTrip(page, "排序測試", "2027-04-01", "2027-04-01");
  for (const name of ["甲", "乙", "丙"]) await addStop(page, name, { stay: "30 分" });
  await setLegMinutes(page, 0, 10);
  await setLegMinutes(page, 1, 20);
  await expect.poll(() => shownTimes(page)).toEqual(["09:00", "09:10", "10:00"]);

  await page.getByRole("button", { name: "排序" }).click();
  await page.getByRole("button", { name: "甲 下移" }).click();
  await page.getByRole("button", { name: "完成" }).click();
  await expect(page.getByRole("link", { name: /交通時間未定/ })).toHaveCount(2);

  await page.getByRole("button", { name: "排序" }).click();
  await page.getByRole("button", { name: "甲 上移" }).click();
  await page.getByRole("button", { name: "完成" }).click();
  await expect.poll(() => shownTimes(page)).toEqual(["09:00", "09:10", "10:00"]);
});

test("a trip created on one device appears on another", async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  await signIn(a);
  await signIn(b);

  await createTrip(a, "跨裝置同步", "2027-06-01", "2027-06-02");
  await addStop(a, "第一站");
  await a.getByRole("link", { name: "返回旅程列表" }).click();
  await expect(a.getByRole("status")).toHaveText("已同步到雲端");

  await b.reload();
  await b.getByRole("link", { name: /跨裝置同步/ }).click();
  await expect(b.getByRole("link", { name: /第一站/ })).toBeVisible();

  await b.getByRole("link", { name: /第一站/ }).click();
  await b.getByLabel("地點名稱").fill("第一站（B 改過）");
  await b.getByRole("button", { name: "儲存" }).click();
  await expect(b.getByRole("link", { name: /第一站（B 改過）/ })).toBeVisible();
  await b.goto("/");
  await expect(b.getByRole("status")).toHaveText("已同步到雲端");

  await a.reload();
  await a.getByRole("link", { name: /跨裝置同步/ }).click();
  await expect(a.getByRole("link", { name: /第一站（B 改過）/ })).toBeVisible();
  await a.close();
  await b.close();
});
