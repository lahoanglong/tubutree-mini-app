/**
 * Hợp đồng API tích điểm đơn mua ngoài app: đơn sàn Shopee/Lazada/TikTok (khách nhập mã vận đơn, `kind` SCAN) và đơn chat/điện thoại
 * do CSKH lên trên Pancake (tự cộng theo SĐT, `kind` PHONE). Dùng chung cho miniapp và web admin.
 */

/** SCAN = đơn sàn khách tự nhập mã; PHONE = đơn chat/điện thoại, hệ thống tự cộng theo SĐT, khách không cần nhập gì. */
export type ExternalClaimKind = 'SCAN' | 'PHONE';

export type ExternalClaimState = 'PENDING' | 'REVIEW' | 'HELD_NO_MEMBER' | 'CREDITED' | 'VOIDED' | 'REVERSED' | 'LAPSED';

/**
 * Kết quả gửi mã: CLAIMED = đã ghi nhận, điểm chờ; REVIEW = chờ nhân viên kiểm; SEARCHING = chưa thấy đơn, hệ thống tìm lại tối đa 3 ngày;
 * CLAIMED_BY_OTHER = mã đang được tài khoản khác chờ tìm đơn (lần gửi này không được tìm tiếp, khách liên hệ CSKH).
 */
export type SubmitExternalClaimStatus = 'CLAIMED' | 'REVIEW' | 'SEARCHING' | 'CLAIMED_BY_OTHER';

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
  | 'ZERO_POINTS'
  /**
   * W42: SĐT (đầy đủ hoặc đã che) trên đơn sàn không khớp SĐT Zalo của khách. Từ W46 chỉ còn ở lượt không có khách trước màn hình (cron ghép
   * lại mã chờ); khách tự gửi mã thì nhận PHONE_CONFIRM_REQUIRED. HTTP 403, câu lỗi không in số trên đơn.
   */
  | 'PHONE_MISMATCH'
  /**
   * W46: SĐT người nhận trên đơn khác SĐT tài khoản. Khách nhập 4 số cuối SĐT nhận hàng rồi gửi lại cùng mã kèm `recipientPhoneLast4`.
   * HTTP 403, thân lỗi kèm `ExternalClaimPhoneConfirmInfo`, không bao giờ kèm chữ số nào của SĐT trên đơn.
   */
  | 'PHONE_CONFIRM_REQUIRED'
  /** W46: 4 số cuối khách nhập chưa khớp; `remainingAttempts` (1 hoặc 2) là số lần nhập sai còn được trong 24 giờ. HTTP 403. */
  | 'PHONE_CONFIRM_WRONG'
  /** W46: đã nhập sai 3 lần trong 24 giờ cho đơn này: khoá xác nhận đơn này 24 giờ, kể cả khi lần sau nhập đúng. HTTP 429. */
  | 'PHONE_CONFIRM_LOCKED';

/** W46: phần thêm trong thân lỗi PHONE_CONFIRM_* để màn xác nhận nói đúng tên sàn và số lượt còn lại. */
export interface ExternalClaimPhoneConfirmInfo {
  /** Tên sàn viết thường theo `pancake.order_source_map` (`shopee`, `lazada`, `tiktok`); null khi đơn sàn không rõ sàn. */
  channel: string | null;
  /** Số chữ số khách nhập: luôn 4 (4 số cuối SĐT nhận hàng). */
  requiredDigits: 4;
  /** Chỉ có ở PHONE_CONFIRM_WRONG (1 hoặc 2) và PHONE_CONFIRM_LOCKED (0). */
  remainingAttempts?: number;
}

/**
 * Điểm Xanh tích từ đơn sàn (lô MARKETPLACE, W42) chỉ dùng để giảm giá khi đặt đơn; vòng quay, góp cây, đổi quà và phí lấy rác không
 * tiêu lô này. API nối câu này vào lỗi thiếu điểm của các đường đó khi khách còn điểm sàn; app dùng cùng câu cạnh số dư.
 */
export const MARKETPLACE_POINTS_ORDER_ONLY_NOTE = 'Điểm tích từ đơn sàn chỉ dùng để giảm giá khi mua hàng trên Web / Mini App Tubu Tree.';

/** Mã lỗi của thao tác admin (ngoài ExternalClaimRejectCode, vốn cũng có thể trả khi gắn đơn chạy luật gửi mã). */
export type ExternalClaimAdminErrorCode =
  | 'SELF_ACTION'
  | 'SAME_INTRODUCER'
  | 'ATTACH_ADMIN_ONLY'
  | 'NOTE_REQUIRED'
  | 'NOT_FLAGGED'
  /** Người duyệt trùng người tạo/phụ trách đơn trên Pancake (chỉ claim PHONE). */
  | 'PANCAKE_CREATOR_SELF';

export interface SubmitExternalClaimRequest {
  /** Mã vận đơn hoặc mã đơn sàn, nhập tay hoặc quét. Server chuẩn hoá (chữ hoa, bỏ khoảng trắng và gạch). */
  code: string;
  /** Khách quét nhãn hay gõ tay; chỉ để đo phễu. */
  via?: 'scan' | 'typed';
  /** W46: 4 số cuối SĐT người nhận ghi trên đơn sàn (`^\d{4}$`), chỉ gửi sau khi API trả PHONE_CONFIRM_REQUIRED cho đúng mã này. */
  recipientPhoneLast4?: string;
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
  /** Có từ gói chatpts. Danh sách mặc định chỉ có SCAN; `GET /me/external-points/claims?kind=PHONE` trả đơn chat. */
  kind: ExternalClaimKind;
  channel: string | null;
  maskedCode: string;
  state: ExternalClaimState;
  /** Điểm chờ hoặc đã cộng; null khi chưa tính được. */
  points: number | null;
  /** Giao xong + loyalty.external_pending_days; null khi đơn chưa giao xong hoặc claim đã ở trạng thái cuối. */
  expectedCreditAt: string | null;
  creditedAt: string | null;
  /** Chỉ claim PHONE ở HELD_NO_MEMBER: hạn giữ điểm; quá hạn mà chưa là thành viên thì mất (LAPSED). */
  holdUntil: string | null;
  createdAt: string;
  /**
   * W59: claim REVIEW chỉ vì SĐT (SĐT web chưa xác minh, SĐT lệch): khách chạm dòng, nhập 4 số cuối SĐT người nhận
   * (`POST /me/external-points/claims/phone-retry` với `claimId`) là sang chờ cộng. Vắng ở API cũ.
   */
  phoneRetry?: true;
}

export interface MySearchingAttempt {
  maskedCode: string;
  createdAt: string;
}

/** W59: mã đã quét mà dừng ở bước 4 số cuối SĐT người nhận (chưa nhập, nhập sai), đơn chưa ai tích. Không phải claim, không vào hàng CSKH. */
export interface MyPhoneRetryAttempt {
  attemptId: string;
  channel: string | null;
  maskedCode: string;
  createdAt: string;
}

export interface MyExternalClaimsResponse {
  data: MyExternalClaimItem[];
  meta: { page: number; limit: number; total: number };
  /** Mã đã gửi mà chưa tìm thấy đơn (chỉ trang 1). */
  searching: MySearchingAttempt[];
  /** W59: mã chờ khách nhập 4 số cuối (chỉ trang 1, tối đa 10, trong 7 ngày). Vắng ở API cũ. */
  needsPhone?: MyPhoneRetryAttempt[];
}

/** W59: nhập lại 4 số cuối từ một dòng lịch sử: đúng một trong `claimId` (claim REVIEW có `phoneRetry`) hoặc `attemptId` (`needsPhone`). */
export interface RetryExternalClaimPhoneRequest {
  claimId?: string;
  attemptId?: string;
  recipientPhoneLast4: string;
}

/**
 * W45: tên người nhận trên đơn sàn so với tên thành viên (đơn chỉ lưu mã băm từng chữ, không lưu tên). MATCH cùng một tập chữ; PARTIAL trùng
 * ít nhất một chữ riêng (không tính họ phổ biến, "Thị", "Văn"); MISMATCH tên đầy đủ không trùng chữ riêng nào; NO_DATA không đủ để so.
 */
export type AdminRecipientNameMatch = 'MATCH' | 'PARTIAL' | 'MISMATCH' | 'NO_DATA';

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
  /** SĐT trên đơn: số đầy đủ đã che, không có thì mẫu che sẵn của sàn (chỉ lộ tối đa 3 ký tự đầu, 3 ký tự cuối). */
  orderPhoneMasked: string | null;
  /**
   * W42, chỉ claim SCAN có khách: SĐT Zalo hiện tại của khách so với SĐT trên đơn. MATCH khớp, MISMATCH lệch (khách gửi mã bị từ chối
   * PHONE_MISMATCH; claim do nhân viên gắn tay thì chờ duyệt), NO_DATA đơn không có SĐT đủ để so. null ở claim PHONE / chưa có khách.
   * Optional: API cũ chưa trả.
   */
  phoneMatch?: 'MATCH' | 'MISMATCH' | 'NO_DATA' | null;
  goodsValue: number | null;
  points: number;
  /** Có từ gói chatpts. Danh sách admin lọc được theo `?kind=SCAN|PHONE`. */
  kind: ExternalClaimKind;
  state: ExternalClaimState;
  /** Chỉ HELD_NO_MEMBER: hạn giữ điểm của đơn chat chưa có thành viên. */
  holdUntil: string | null;
  orderStatus: string;
  reviewReason: string | null;
  voidReason: string | null;
  decidedById: string | null;
  deliveredAt: string | null;
  creditedAt: string | null;
  createdAt: string;
  /**
   * Claim đã có thành viên, cả PHONE lẫn SCAN (từ W45; null khi chưa có thành viên): để người kiểm đối chiếu người nhận với lý do REVIEW.
   * `memberPhoneVerifiedAt` là lần gần nhất Zalo trả đúng SĐT này. `memberPhoneStale` chỉ có nghĩa ở claim PHONE (luôn false ở SCAN): mốc
   * xác minh đã quá hạn (hoặc chưa có), nên người nhận chưa được xác nhận và nút Duyệt đòi ghi chú.
   */
  memberPhoneVerifiedAt?: string | null;
  memberPhoneStale?: boolean;
  memberCreatedAt?: string | null;
  /** Số đơn mua trong app của thành viên đã giao (DELIVERED): thành viên đã mua thật thì SĐT đáng tin hơn. */
  memberDeliveredAppOrders?: number | null;
  /**
   * W45, chỉ claim SCAN có thành viên: số claim đơn sàn KHÁC của thành viên này đã cộng điểm (CREDITED, không tính claim đang xem), để duyệt
   * nhanh khách quen khi đơn không có SĐT để đối chiếu. null ở claim PHONE / chưa có thành viên.
   */
  memberCreditedMarketplaceClaims?: number | null;
  /** W45, chỉ claim SCAN: giỏ hàng tóm tắt không có tên món ("3 sản phẩm, 2 dòng: 2 × 150.000đ, 1 × 89.000đ"); null khi đơn thiếu số. */
  itemSummary?: string | null;
  /** W45, chỉ claim SCAN có thành viên: tên người nhận trên đơn so với tên thành viên. null ở claim PHONE / chưa có thành viên. */
  recipientNameMatch?: AdminRecipientNameMatch | null;
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
export type AdminExternalClaimAttentionFilter = 'closed_credited' | 'stale' | 'partial_refund';

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
  /** Số tài khoản KHÁC đã gửi cùng mã này (30 ngày gần nhất, kể cả lượt đã đóng). CSKH gắn đơn đúng người. */
  otherSubmittersCount?: number;
  /** Tối đa 10 người gửi gần nhất; SĐT đã che. */
  otherSubmitters?: AdminExternalAttemptOtherSubmitter[];
}

export interface AdminExternalAttemptOtherSubmitter {
  userId: string;
  userName: string | null;
  userPhoneMasked: string | null;
  createdAt: string;
  /**
   * Kết quả lượt gửi gần nhất của người này: `UNMATCHED`, `NOT_FOUND`, `REJECTED_PHONE_MISMATCH` (W42) hay `REJECTED_NOT_ELIGIBLE_USER`
   * (W45, SĐT tự gõ trên web mà đơn không đủ căn cứ). API cũ chưa trả.
   */
  result?: string;
}

export interface AdminExternalAttemptListResponse {
  data: AdminExternalAttemptRow[];
  meta: { page: number; limit: number; total: number };
}

/** Duyệt claim. `note` bắt buộc khi lý do REVIEW là "SĐT xác minh đã cũ" và mốc đó vẫn cũ lúc duyệt (người duyệt ghi cách đã xác nhận người nhận). */
export interface AdminApproveClaimRequest {
  note?: string;
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

/** Kỳ của phễu tích điểm đơn sàn: 7, 30 hoặc 90 ngày tính lùi từ lúc gọi. */
export type ExternalClaimFunnelPeriod = '7d' | '30d' | '90d';

/**
 * GET /admin/external-claims/funnel: phễu đơn sàn → điểm → mua lại trên Mini App/web trong [from, to). Chỉ claim SCAN (đơn sàn khách
 * nhập mã); claim PHONE (đơn chat) không tính. Chỉ số đếm và tổng, không định danh khách.
 */
export interface ExternalClaimFunnel {
  period: ExternalClaimFunnelPeriod;
  /** ISO, mốc đầu (gồm). */
  from: string;
  /** ISO, mốc cuối (không gồm), là lúc tính. */
  to: string;
  /** Lượt gửi mã (sự kiện `ext_claim_submitted`). `scan` + `typed` có thể nhỏ hơn `total`: bản app cũ không gửi cách nhập. */
  submissions: { total: number; scan: number; typed: number };
  /** Số đơn sàn có claim SCAN tạo trong kỳ. */
  matchedOrders: number;
  /**
   * `rejected`: lượt gửi mã trong kỳ bị từ chối vì SĐT trên đơn lệch, cả lúc gửi lẫn lúc hệ thống ghép lại; `review`: claim SCAN tạo trong kỳ
   * từng phải chờ duyệt vì SĐT lệch (kể cả đã duyệt, đã cộng sau đó).
   */
  phoneMismatch: { rejected: number; review: number };
  /**
   * W45: claim SCAN tạo trong kỳ từng chờ duyệt vì đơn sàn không có SĐT để đối chiếu tự động (`review`, kể cả đã duyệt hay cộng sau đó),
   * tách khỏi `phoneMismatch.review`; `waiting` = phần trong số đó hiện vẫn chờ duyệt với đúng lý do này. Optional: API cũ chưa trả.
   */
  noPhoneReview?: { review: number; waiting: number };
  /** Số mã gửi trong kỳ mà tới giờ chưa lượt nào tìm thấy đơn (đếm theo mã, không theo lượt gửi). */
  unmatched: number;
  /** Claim SCAN tạo trong kỳ đang chờ cộng hoặc chờ duyệt, và số điểm của chúng. */
  pending: { claims: number; points: number };
  /** Claim SCAN đã cộng điểm trong kỳ (theo lúc cộng) và chưa bị đảo; `users` đếm tài khoản đã gộp một lần. */
  credited: { claims: number; points: number; users: number };
  /**
   * Khách trong `credited.users` có đơn lẻ trên Mini App/web đặt sau lần cộng đầu trong kỳ, trước `to`, đang chạy hoặc đã giao.
   * `gmv` theo tổng tiền đơn (VND); `rate` = users / credited.users, từ 0 đến 1, 0 khi chưa có ai được cộng.
   */
  converted: { users: number; orders: number; gmv: number; rate: number };
}
