/** Hợp đồng API tích điểm đơn mua ngoài app (đơn sàn Shopee/Lazada/TikTok). Dùng chung cho miniapp và web admin. */

export type ExternalClaimState = 'PENDING' | 'REVIEW' | 'HELD_NO_MEMBER' | 'CREDITED' | 'VOIDED' | 'REVERSED' | 'LAPSED';

/** Kết quả gửi mã: CLAIMED = đã ghi nhận, điểm chờ; REVIEW = chờ nhân viên kiểm; SEARCHING = chưa thấy đơn, hệ thống tìm lại tối đa 3 ngày. */
export type SubmitExternalClaimStatus = 'CLAIMED' | 'REVIEW' | 'SEARCHING';

/** Lý do từ chối ổn định để miniapp chọn chữ; `message` là câu tiếng Việt sẵn dùng. */
export type ExternalClaimRejectCode =
  | 'DISABLED'
  | 'NOT_ELIGIBLE_USER'
  | 'INVALID_CODE'
  | 'LOCKED'
  | 'DAILY_ATTEMPTS'
  | 'APP_ORDER'
  | 'CHAT_ORDER'
  | 'TOO_OLD'
  | 'BEFORE_SINCE'
  | 'CLOSED'
  | 'ALREADY_CLAIMED'
  | 'DAILY_MAX'
  | 'MONTHLY_CAP'
  | 'ZERO_POINTS';

/** Mã lỗi của thao tác admin (ngoài ExternalClaimRejectCode, vốn cũng có thể trả khi gắn đơn chạy luật gửi mã). */
export type ExternalClaimAdminErrorCode = 'SELF_ACTION' | 'SAME_INTRODUCER' | 'ATTACH_ADMIN_ONLY' | 'NOTE_REQUIRED' | 'NOT_FLAGGED';

export interface SubmitExternalClaimRequest {
  /** Mã vận đơn hoặc mã đơn sàn, nhập tay hoặc quét. Server chuẩn hoá (chữ hoa, bỏ khoảng trắng và gạch). */
  code: string;
}

export interface SubmitExternalClaimResponse {
  status: SubmitExternalClaimStatus;
  /** Chỉ có khi CLAIMED/REVIEW. */
  claimId: string | null;
  channel: string | null;
  maskedCode: string;
  /** Điểm chờ cộng; null khi chưa tính được (REVIEW vì thiếu tiền hàng) hoặc đang tìm đơn. */
  points: number | null;
  /** Mốc dự kiến cộng điểm (ISO); null khi đơn chưa giao xong. */
  expectedCreditAt: string | null;
  message: string;
}

export interface MyExternalClaimItem {
  id: string;
  channel: string | null;
  maskedCode: string;
  state: ExternalClaimState;
  /** Điểm chờ hoặc đã cộng; null khi chưa tính được. */
  points: number | null;
  /** Giao xong + loyalty.external_pending_days; null khi đơn chưa giao xong hoặc claim đã ở trạng thái cuối. */
  expectedCreditAt: string | null;
  creditedAt: string | null;
  createdAt: string;
}

export interface MySearchingAttempt {
  maskedCode: string;
  createdAt: string;
}

export interface MyExternalClaimsResponse {
  data: MyExternalClaimItem[];
  meta: { page: number; limit: number; total: number };
  /** Mã đã gửi mà chưa tìm thấy đơn (chỉ trang 1). */
  searching: MySearchingAttempt[];
}

/** Hàng claim cho admin. SĐT luôn che; không bao giờ trả payload. */
export interface AdminExternalClaimRow {
  id: string;
  externalOrderId: string;
  pancakeOrderId: string;
  channel: string | null;
  source: 'MARKETPLACE' | 'CHAT' | 'UNKNOWN';
  maskedCode: string;
  userId: string | null;
  userName: string | null;
  userPhoneMasked: string | null;
  orderPhoneMasked: string | null;
  goodsValue: number | null;
  points: number;
  state: ExternalClaimState;
  orderStatus: string;
  reviewReason: string | null;
  voidReason: string | null;
  decidedById: string | null;
  deliveredAt: string | null;
  creditedAt: string | null;
  createdAt: string;
}

/** Một dòng nhật ký chỉ-thêm của claim: mọi thao tác của người, cron và khách. */
export interface AdminExternalClaimEvent {
  id: string;
  action: string;
  actorId: string | null;
  fromState: string | null;
  toState: string | null;
  userIdBefore: string | null;
  userIdAfter: string | null;
  note: string | null;
  /** Trạng thái đơn ngoài lúc ghi sự kiện; có ở APPROVE/ATTACH. */
  orderStatus: string | null;
  createdAt: string;
}

export interface AdminExternalClaimDetail extends AdminExternalClaimRow {
  events: AdminExternalClaimEvent[];
}

/** Bộ lọc `attention` của GET /admin/external-claims (thêm sau review lượt 3): đúng các dòng mục "Cần xử lý" đếm. */
export type AdminExternalClaimAttentionFilter = 'closed_credited' | 'stale';

export interface AdminExternalClaimListResponse {
  data: AdminExternalClaimRow[];
  meta: { page: number; limit: number; total: number };
}

export interface AdminExternalAttemptRow {
  id: string;
  userId: string;
  userName: string | null;
  userPhoneMasked: string | null;
  maskedCode: string;
  result: string;
  externalOrderId: string | null;
  note: string | null;
  createdAt: string;
}

export interface AdminExternalAttemptListResponse {
  data: AdminExternalAttemptRow[];
  meta: { page: number; limit: number; total: number };
}

export interface AdminExternalReasonRequest {
  reason: string;
}

export interface AdminAttachAttemptRequest {
  /** id Pancake của đơn (external_orders.pancakeOrderId) cần gắn vào lần gửi mã. */
  pancakeOrderId: string;
  /** Bắt buộc (và chỉ ADMIN) khi mã không trùng mã trên đơn hoặc đơn có nguồn UNKNOWN. */
  note?: string;
}

/** "Giữ điểm, gỡ cờ" cho claim đã cộng mà đơn hoàn một phần (chỉ ADMIN). Không thu hồi một phần. */
export interface AdminKeepPointsRequest {
  note: string;
}

export interface AdminAttachAttemptResponse {
  claimId: string;
  state: 'PENDING' | 'REVIEW';
}

export interface AdminRejectAttemptRequest {
  note?: string;
}

export interface AdminReverseClaimResponse {
  claimId: string;
  /** Số điểm thực thu hồi: min(điểm đã cộng, phần lô còn thu hồi được, số dư). */
  reversedPoints: number;
}
