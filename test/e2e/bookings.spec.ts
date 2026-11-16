import { expect, test, type Page } from "@playwright/test";
import { addStop, createTrip, cutApi, setLegMinutes, signIn } from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");

function idbRows(page: Page, store: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    (name) =>
      new Promise<Record<string, unknown>[]>((resolve) => {
        const open = indexedDB.open("travel-planner");
        open.onsuccess = () => {
          const req = open.result.transaction(name).objectStore(name).getAll();
          req.onsuccess = () => {
            resolve((req.result as Record<string, unknown>[]).map((r) => ({ ...r, blob: undefined })));
            open.result.close();
          };
        };
      }),
    store,
  );
}

async function openStop(page: Page, name: string) {
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
}

test("a late booking shows a conflict, a one-tap fix, and appears on the bookings tab", async ({ page }) => {
  await signIn(page);
  await createTrip(page, "訂位測試", "2027-03-26", "2027-03-26");
  await page.getByLabel("當日出發時間").fill("09:12");
  await addStop(page, "京都車站", { kind: "交通", stay: "不停留" });
  await addStop(page, "清水寺", { stay: "2 小時" });
  await addStop(page, "錦市場 午餐", { kind: "餐廳" });
  await setLegMinutes(page, 0, 40);
  await setLegMinutes(page, 1, 25);

  await openStop(page, "錦市場 午餐");
  await page.getByLabel("有訂位或票券").check();
  await page.getByLabel("訂位時間").fill("12:00");
  await page.getByLabel("訂位代號").fill("KY-2048");
  await page.getByLabel("確認連結").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("alert")).toHaveText("確認連結需要是 http 或 https 開頭的網址。");
  await page.getByLabel("確認連結").fill("https://example.com/booking/2048");
  await page.getByRole("button", { name: "儲存" }).click();

  await expect(page.getByText("預計比訂位時間晚 17 分抵達")).toBeVisible();
  await expect(page.getByText("訂位 12:00 · 2 位 · 代號 KY-2048")).toBeVisible();

  await page.getByRole("navigation").getByRole("link", { name: "訂位" }).click();
  await expect(page.getByRole("heading", { name: "錦市場 午餐" })).toBeVisible();
  await expect(page.getByText("目前行程預計 12:17 抵達，晚 17 分")).toBeVisible();
  await expect(page.getByRole("link", { name: "開啟訂位連結" })).toHaveAttribute("href", "https://example.com/booking/2048");
  await page.getByRole("link", { name: "在行程中查看" }).click();

  await page.getByRole("button", { name: "清水寺停留縮短為 1 小時 30 分" }).click();
  await expect(page.getByText(/預計比訂位時間晚/)).toHaveCount(0);
});

test("files attached offline upload later and reach another device", async ({ browser }) => {
  const a = await browser.newPage();
  await signIn(a);
  await createTrip(a, "附件測試", "2027-04-10", "2027-04-10");
  await addStop(a, "旅館", { kind: "住宿" });

  await cutApi(a);
  await openStop(a, "旅館");
  await a.getByLabel("有訂位或票券").check();
  await a.locator('input[type="file"]').setInputFiles([
    { name: "確認信.pdf", mimeType: "application/pdf", buffer: PDF },
    { name: "qr.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(a.getByText("確認信.pdf")).toBeVisible();
  await expect(a.getByText("qr.png")).toBeVisible();
  await a.getByRole("button", { name: "儲存" }).click();
  await expect(a.getByRole("link", { name: /旅館/ })).toBeVisible();
  expect((await idbRows(a, "attachments")).map((r) => r.uploaded)).toEqual([0, 0]);

  await a.unroute("**/api/**");
  await a.goto("/");
  await expect(a.getByRole("status")).toHaveText("已同步到雲端");
  await expect.poll(async () => (await idbRows(a, "attachments")).map((r) => r.uploaded)).toEqual([1, 1]);

  const ids = (await idbRows(a, "attachments")).map((r) => String(r.id));
  for (const id of ids) {
    const res = await a.request.get(`/api/attachments/${id}`);
    expect(res.status()).toBe(200);
  }

  const b = await browser.newPage();
  await signIn(b);
  await expect.poll(async () => (await idbRows(b, "blobs")).length).toBe(2);
  await b.getByRole("link", { name: /附件測試/ }).click();
  await b.getByRole("navigation").getByRole("link", { name: "訂位" }).click();
  await expect(b.getByRole("button", { name: "確認信.pdf" })).toBeVisible();
  await a.close();
  await b.close();
});
