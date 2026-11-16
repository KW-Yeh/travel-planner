import type { LegMode, ReservationStatus, StopKind } from "../../shared/schema";

export const KIND_LABEL: Record<StopKind, string> = {
  sight: "景點",
  food: "餐廳",
  lodging: "住宿",
  transport: "交通",
  other: "其他",
};

/** Default stay when a type is picked; the user can change it. */
export const KIND_DEFAULT_STAY: Record<StopKind, number> = {
  sight: 90,
  food: 60,
  lodging: 0,
  transport: 15,
  other: 30,
};

export const MODE_LABEL: Record<LegMode, string> = {
  transit: "大眾運輸",
  drive: "開車／計程車",
  walk: "步行",
  bicycle: "自行車",
};

export const MODE_SHORT: Record<LegMode, string> = {
  transit: "大眾運輸",
  drive: "開車",
  walk: "步行",
  bicycle: "自行車",
};

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  confirmed: "已確認",
  pending: "待確認",
  payment_due: "需付款",
};

export const STAY_OPTIONS = [0, 15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 360, 480, 600, 720];
