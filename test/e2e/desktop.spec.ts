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
