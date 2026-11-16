import { describe, expect, it } from "vitest";
import { describeSync } from "./SyncStatus";

describe("describeSync", () => {
  it.each([
    ["idle", 0, "已同步到雲端"],
    ["idle", 2, "2 筆待上傳"],
    ["syncing", 3, "同步中…"],
    ["offline", 3, "離線（3 筆待上傳）"],
    ["offline", 0, "離線，顯示本機資料"],
    ["error", 0, "同步失敗，稍後重試"],
  ] as const)("%s with %i pending → %s", (phase, pending, text) => {
    expect(describeSync(phase, pending).text).toBe(text);
  });
});
