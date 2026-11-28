/**
 * Tặng thiện chí của quản trị viên (w51-01): Điểm Xanh vào lô thường hoặc tiền vào Ví Tubu, chỉ ADMIN, có trần và ghi admin_audit_logs.
 * API (modules/loyalty/goodwill-credit.*) và form ở hồ sơ khách (web admin) đọc chung các số này.
 */
export type GoodwillKind = 'POINTS' | 'WALLET';

/** Trần một lần tặng: 200.000 Điểm Xanh hoặc 200.000đ (1 điểm tiêu như 1đ, loyalty.vnd_per_point_redeem = 1). */
export const GOODWILL_MAX_PER_GRANT = 200_000;
/** Trần mỗi quản trị viên mỗi ngày (giờ VN), cộng cả điểm và tiền theo mệnh giá 1 điểm = 1đ. */
export const GOODWILL_DAILY_CAP_PER_ADMIN = 1_000_000;
export const GOODWILL_REASON_MIN = 10;
export const GOODWILL_REASON_MAX = 500;

/** Chữ khách thấy ở sổ Ví / sổ Điểm Xanh. Lý do nội bộ của quản trị viên chỉ nằm ở admin_audit_logs, không tới khách. */
export const GOODWILL_GIFT_LABEL = 'Quà tặng từ Tubu Tree';
/** Mã đầu `reason` của dòng sổ Điểm Xanh: `GOODWILL` hoặc `GOODWILL:<mã đơn>`. */
export const GOODWILL_POINTS_REASON_CODE = 'GOODWILL';

export interface GoodwillCreditItem {
  id: string;
  kind: GoodwillKind;
  amount: number;
  /** Lý do nội bộ quản trị viên gõ. */
  reason: string;
  orderCode: string | null;
  actorId: string;
  actorName: string | null;
  createdAt: string;
}

/** `GET /admin/users/:id/goodwill-credits`: lần tặng gần nhất cho khách này và hạn mức hôm nay của người xem. */
export interface GoodwillCreditList {
  perGrantMax: number;
  dailyCap: number;
  /** Người đang xem đã tặng bao nhiêu hôm nay (mọi khách). */
  dailyUsed: number;
  items: GoodwillCreditItem[];
}

/** `POST /admin/users/:id/goodwill-credits`. `replayed`: cùng Idempotency-Key gửi lại, không ghi sổ lần hai. */
export interface GoodwillCreditResult {
  id: string;
  kind: GoodwillKind;
  amount: number;
  orderCode: string | null;
  entryId: string;
  replayed: boolean;
  dailyUsed: number;
  dailyCap: number;
  createdAt: string;
}
