import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "../api/client";
import { describeLoginError, formatWait } from "./login-messages";

describe("formatWait", () => {
  it.each([
    [0, "0 秒"],
    [0.2, "1 秒"],
    [45, "45 秒"],
    [60, "1 分"],
    [900, "15 分"],
    [905, "15 分 5 秒"],
    [3600, "1 小時"],
    [86_399, "23 小時 59 分"],
  ])("%s s → %s", (sec, text) => {
    expect(formatWait(sec)).toBe(text);
  });
});

describe("describeLoginError", () => {
  it("maps each server error to a message", () => {
    expect(describeLoginError(new ApiError(401, "invalid_credentials")).message).toBe("帳號或密碼不正確。");
    expect(describeLoginError(new ApiError(503, "auth_not_configured")).message).toContain("尚未設定");
    expect(describeLoginError(new NetworkError(new TypeError("offline"))).message).toContain("無法連線");
    expect(describeLoginError(new Error("boom")).message).toContain("稍後再試");
  });

  it("carries the lock duration for 429", () => {
    expect(describeLoginError(new ApiError(429, "too_many_attempts", 900))).toEqual({
      message: "嘗試次數過多，已暫時鎖定。",
      lockedForSec: 900,
    });
  });
});
