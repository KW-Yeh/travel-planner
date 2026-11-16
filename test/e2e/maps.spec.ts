import { expect, test } from "@playwright/test";
import { createTrip, signIn } from "./helpers";

// The e2e Worker runs without Google keys, so this covers the no-key fallbacks end to end.
test("without Google keys: links give coordinates, legs are manual, and the map tab shows a list", async ({ page }) => {
  await signIn(page);
  await createTrip(page, "京都地圖", "2027-03-26", "2027-03-26");

  await page.getByRole("link", { name: "新增地點" }).click();
  await expect(page.getByText("尚未設定 Google 地圖金鑰，無法搜尋")).toBeVisible();
  await page.getByLabel("貼上 Google Maps 連結").fill("https://www.google.com/maps/place/Kyoto+Station/@34.9858,135.7588,17z");
  await page.getByRole("button", { name: "使用這個連結" }).click();
  await expect(page.getByText("已取得座標")).toBeVisible();
  await expect(page.getByLabel("地點名稱")).toHaveValue("Kyoto Station");
  await page.getByRole("button", { name: "儲存" }).click();

  await page.getByRole("link", { name: "新增地點" }).click();
  await page.getByLabel("地點名稱").fill("清水寺");
  await page.getByRole("button", { name: "儲存" }).click();

  await page.locator('main a[href*="/legs/"]').first().click();
  await expect(page.getByText("尚未設定 Google 路線金鑰")).toBeVisible();
  await expect(page.getByLabel(/手動輸入交通時間/)).toBeChecked();
  await expect(page.getByRole("link", { name: "在 Google Maps 開啟" })).toHaveAttribute("href", /google\.com\/maps\/dir\/\?api=1/);
  await page.getByLabel("交通時間（分鐘）").fill("25");
  await page.getByRole("button", { name: "套用" }).click();

  await page.getByRole("navigation").getByRole("link", { name: "地圖" }).click();
  await expect(page.getByText("尚未設定 Google 地圖金鑰，先以清單顯示。")).toBeVisible();
  const list = page.getByRole("region", { name: "地點清單" });
  await expect(list.getByRole("button", { name: /1\s*Kyoto Station/ })).toBeVisible();
  await expect(list.getByRole("button", { name: /2\s*清水寺.*沒有座標/ })).toBeVisible();
  await expect(list.getByRole("link", { name: /大眾運輸 25 分/ })).toHaveAttribute("href", /destination=%E6%B8%85%E6%B0%B4%E5%AF%BA/);
});
