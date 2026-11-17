import { expect, test } from "@playwright/test";
import { addStop, createTrip, pickStay, signIn } from "./helpers";

test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

test("desktop keeps the timeline beside the stop editor and uses a side nav", async ({ page }) => {
  await signIn(page);
  await createTrip(page, "桌面版", "2027-04-01", "2027-04-01");
  await addStop(page, "甲", { stay: "30 分" });

  const nav = page.getByRole("navigation", { name: "主要導覽" });
  await expect(nav.getByRole("heading", { name: "桌面版" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "行程" })).toHaveAttribute("aria-current", "page");

  await page.getByRole("link", { name: /^甲/ }).click();
  await expect(page.getByRole("heading", { name: "編輯地點" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^甲/ })).toHaveAttribute("aria-current", "page");

  await pickStay(page, "1 小時");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("heading", { name: "編輯地點" })).toBeHidden();
  await expect(page.getByText("停留 1 小時")).toBeVisible();

  await nav.getByRole("link", { name: "訂位" }).click();
  await expect(page.getByRole("heading", { name: "訂位與票券" })).toBeVisible();
});

test("opening a leg keeps its day selected, and its note shows on the timeline", async ({ page }) => {
  await signIn(page);
  await createTrip(page, "兩天", "2027-04-01", "2027-04-02");
  await page.getByRole("button", { name: /Day 2/ }).click();
  await addStop(page, "乙一");
  await addStop(page, "乙二");
  await expect(page.getByRole("button", { name: /Day 2/ })).toHaveAttribute("aria-pressed", "true");

  await page.locator('main a[href*="/legs/"]').first().click();
  await expect(page.getByRole("heading", { name: "交通方式" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Day 2/ })).toHaveAttribute("aria-pressed", "true");

  await page.getByLabel("交通時間（分鐘）").fill("40");
  await page.getByLabel("備註").fill("JR 奈良線 2 號月台");
  await page.getByRole("button", { name: "套用" }).click();
  await expect(page.getByRole("heading", { name: "交通方式" })).toBeHidden();
  await expect(page.getByRole("button", { name: /Day 2/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: /大眾運輸 40 分.*JR 奈良線 2 號月台/ })).toBeVisible();
});

test("a mouse can drag and wheel the day strip to reach later days", async ({ page }) => {
  await signIn(page);
  await createTrip(page, "十四天", "2027-04-01", "2027-04-14");

  const strip = page.getByRole("group", { name: "選擇日期" });
  const lastDay = strip.getByRole("button", { name: /Day 14/ });
  const scrollLeft = () => strip.evaluate((el) => el.scrollLeft);
  expect(await strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await scrollLeft()).toBe(0);

  // Drag left from the middle of the strip: it scrolls, and the drag does not select a day.
  const box = await strip.boundingBox();
  if (!box) throw new Error("day strip has no box");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 40, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, y, { steps: 10 });
  await page.mouse.up();
  const afterDrag = await scrollLeft();
  expect(afterDrag).toBeGreaterThan(100);
  await expect(strip.getByRole("button", { name: /Day 1 / })).toHaveAttribute("aria-pressed", "true");

  // A vertical wheel over the strip moves it sideways.
  await page.mouse.wheel(0, 2000);
  await expect.poll(scrollLeft).toBeGreaterThan(afterDrag);
  await expect(lastDay).toBeInViewport();

  // A plain click still selects.
  await lastDay.click();
  await expect(lastDay).toHaveAttribute("aria-pressed", "true");
});
