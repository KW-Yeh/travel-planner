import { ApiError, NetworkError } from "../api/client";

export function formatWait(totalSec: number): string {
  const sec = Math.max(0, Math.ceil(totalSec));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (hours > 0) return minutes > 0 ? `${hours} 小時 ${minutes} 分` : `${hours} 小時`;
  if (minutes > 0) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  return `${seconds} 秒`;
}

export type LoginFailure = { message: string; lockedForSec?: number };

export function describeLoginError(error: unknown): LoginFailure {
  if (error instanceof NetworkError) return { message: "無法連線，請確認網路後再試。" };
  if (error instanceof ApiError) {
    switch (error.code) {
      case "invalid_credentials":
        return { message: "帳號或密碼不正確。" };
      case "too_many_attempts":
        return { message: "嘗試次數過多，已暫時鎖定。", lockedForSec: error.retryAfterSec ?? 60 };
      case "auth_not_configured":
        return { message: "伺服器尚未設定登入帳號，請聯絡管理者。" };
      default:
        break;
    }
  }
  return { message: "登入時發生錯誤，請稍後再試。" };
}
