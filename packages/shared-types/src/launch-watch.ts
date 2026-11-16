import type { RecycleFunnelStep } from './analytics';

/** Cửa sổ trượt của bảng theo dõi sau launch: 72 giờ, 7 ngày, 30 ngày (tính tới lúc gọi). */
export const LAUNCH_WATCH_WINDOWS = ['h72', 'd7', 'd30'] as const;
export type LaunchWatchWindow = (typeof LAUNCH_WATCH_WINDOWS)[number];

/** Số khách khác nhau (userId, rồi anonymousId, rồi sessionId) đã đi qua một bước phễu Đổi rác, tách theo nền tảng. `total` đếm khách khác nhau trên cả hai nền tảng nên không bằng web + miniapp. */
export interface LaunchWatchFunnelRow {
  step: RecycleFunnelStep;
  web: number;
  miniapp: number;
  total: number;
}

export interface LaunchWatchFunnel {
  /** Đủ mọi bước của `RECYCLE_FUNNEL_STEPS`, đúng thứ tự, bước chưa có sự kiện là 0. */
  rows: LaunchWatchFunnelRow[];
  /** Sự kiện máy chủ `recycle_confirmed`: kho đã nhận rác thật. */
  confirmedRequests: number;
  confirmedUsers: number;
}

export interface LaunchWatchFraud {
  /** `totalRequests`: mọi yêu cầu Đổi rác tạo trong cửa sổ. `requests`, `users`: phần của tài khoản chưa xác thực số điện thoại (`phoneVerifiedAt` rỗng; điều kiện mở Đổi rác chỉ là có số điện thoại nên họ vẫn tạo được yêu cầu). `pointsAwarded` chỉ để tham khảo: Điểm Xanh đã cộng cho các tài khoản đó sau khi kho xác nhận, KHÔNG kỳ vọng bằng 0. */
  unverifiedPhone: { totalRequests: number; requests: number; users: number; pointsAwarded: number };
  /**
   * Quà hiện vật 0đ đã gắn vào đơn mua. `ordersOverOne` và `ordersBelowMin` là vi phạm luật W179 (kỳ vọng 0). `countedSince` (ISO) là mốc đầu của đơn được đếm:
   * muộn hơn đầu cửa sổ khi cửa sổ trải qua lúc luật W179 lên PROD, vì đơn trước đó đi theo luật cũ (không sàn, nhiều quà) nên không tính vi phạm.
   */
  zeroGift: { attached: number; accounts: number; maxPerAccount: number; ordersOverOne: number; ordersBelowMin: number; countedSince: string };
  /** Lần đặt (một lần thanh toán, kể cả khi tách nhiều đơn) của khách mua lẻ trong cửa sổ có thu rác kèm đơn (miễn ship), trừ đơn đã huỷ. `shareOfOrdersPct` null khi cửa sổ chưa có đơn nào. */
  freeShipRecycle: { orders: number; users: number; totalOrders: number; shareOfOrdersPct: number | null; withConfirmedWaste: number };
}

export interface LaunchWatchWindowDTO {
  funnel: LaunchWatchFunnel;
  fraud: LaunchWatchFraud;
}

/** Khách đặt đơn thứ hai trong 14 ngày kể từ đơn đầu. `matured`: đơn đầu cách đây 14 đến 44 ngày (đủ 14 ngày để kết luận). `pending`: đơn đầu trong 14 ngày gần đây (con số còn tăng). */
export interface LaunchWatchSecondOrder {
  windowDays: 14;
  matured: { customers: number; withSecond: number };
  pending: { customers: number; withSecond: number };
}

/** Nguồn webhook được đếm số lần bị từ chối 401 (chỉ số đếm theo nguồn, không lưu token/header/IP/nội dung). */
export const LAUNCH_WATCH_WEBHOOK_SOURCES = ['pancake', 'gomdon'] as const;
export type LaunchWatchWebhookSource = (typeof LAUNCH_WATCH_WEBHOOK_SOURCES)[number];

/**
 * Số lần một nguồn webhook bị từ chối 401. `lastHour`: 60 phút gần nhất; `last24h`: 24 giờ gần nhất; `peakPerHour`: giờ nhiều nhất trong 24 giờ
 * (cộng 12 khung 5 phút liên tiếp); `lastAt` (ISO): đầu khung 5 phút mới nhất có lần từ chối trong 24 giờ, null khi không có; `alert`: `lastHour` đạt ngưỡng.
 */
export interface LaunchWatchWebhookReject {
  source: LaunchWatchWebhookSource;
  lastHour: number;
  last24h: number;
  peakPerHour: number;
  lastAt: string | null;
  alert: boolean;
}

export interface LaunchWatchWebhookRejects {
  /** Số lần bị từ chối trong 1 giờ từ mức này trở lên thì báo (SystemConfig `ops.webhook_reject_alert_per_hour`). */
  thresholdPerHour: number;
  /** Đủ mọi nguồn của `LAUNCH_WATCH_WEBHOOK_SOURCES`, đúng thứ tự, nguồn chưa có lần từ chối là 0. */
  sources: LaunchWatchWebhookReject[];
}

export interface LaunchWatchDTO {
  generatedAt: string;
  windows: Record<LaunchWatchWindow, LaunchWatchWindowDTO>;
  secondOrder: LaunchWatchSecondOrder;
  webhookRejects: LaunchWatchWebhookRejects;
}
