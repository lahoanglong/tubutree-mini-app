/**
 * Nhãn tiếng Việt cho sổ Điểm Xanh và sổ Ví Tubu — cùng bảng với Mini App (account-api.ts `pointsReasonLabel`,
 * wallet-rules.ts `walletTxLabel`) để khách đối chiếu số dư ở đâu cũng thấy cùng một câu. Không bao giờ in mã kỹ thuật thô.
 */

type ReasonRef = 'order' | 'day';
interface ReasonRule {
  label: string;
  /** Phần sau mã có nghĩa với người đọc: mã đơn (ORDER_*, RETURN_*) hoặc ngày thứ mấy của chuỗi điểm danh. */
  ref?: ReasonRef;
}

const AFTER_REDEEM_ORDER: ReasonRule = { label: 'Dùng điểm khi thanh toán', ref: 'order' };
const REFUND_ORDER_POINTS: ReasonRule = { label: 'Hoàn điểm đơn huỷ/trả', ref: 'order' };
const REFUND_RETURN_POINTS: ReasonRule = { label: 'Hoàn lại điểm đã dùng (trả hàng)', ref: 'order' };
// Đơn bị hoàn trọn (ORDER_REVERSED) và từng phiếu trả một phần (RETURN_REVERSED) cùng là thu lại điểm đã cộng: một nhãn.
const RETURN_REVERSED_POINTS: ReasonRule = { label: 'Thu hồi điểm của đơn trả hàng', ref: 'order' };
const REFERRAL_REWARD: ReasonRule = { label: 'Thưởng giới thiệu bạn bè' };
const REFERRAL_REVOKED: ReasonRule = { label: 'Thu hồi thưởng giới thiệu' };
const REFERRAL_DEBT: ReasonRule = { label: 'Ghi nợ thu hồi thưởng giới thiệu' };
const COMMUNITY_REWARD: ReasonRule = { label: 'Thưởng cộng đồng' };
const GARDEN_REWARD: ReasonRule = { label: 'Phần thưởng Vườn Xanh' };

/**
 * Mã đầu của `reason` (trước dấu ":") → nhãn. Đủ mọi mã API ghi vào points_transactions (liệt kê ở ledger-labels.spec.ts).
 * Khớp đúng mã trước; mã mới có hậu tố lạ vẫn rơi vào bảng họ ở `familyRule` rồi mới tới nhãn chung.
 */
const POINTS_REASON_RULES: Record<string, ReasonRule> = {
  ORDER_DELIVERED: { label: 'Tích điểm từ đơn hàng', ref: 'order' },
  ORDER_REVERSED: RETURN_REVERSED_POINTS,
  ORDER_REFUND_POINTS: { label: 'Hoàn lại điểm đã dùng', ref: 'order' },
  ORDER_REFUND_CONVERTED: REFUND_ORDER_POINTS,
  ORDER_REFUND_XU: REFUND_ORDER_POINTS,
  ORDER_REDEEM: AFTER_REDEEM_ORDER,
  ORDER_REDEEM_CONVERTED: AFTER_REDEEM_ORDER,
  RETURN_REVERSED: RETURN_REVERSED_POINTS,
  RETURN_REFUND_POINTS: REFUND_RETURN_POINTS,
  RETURN_REFUND_CONVERTED: REFUND_RETURN_POINTS,
  LOYALTY_REDEEM_VOUCHER: { label: 'Đổi điểm lấy mã giảm giá' },
  DAILY_CHECKIN: { label: 'Điểm danh hằng ngày', ref: 'day' },
  POS_OFFLINE_ORDER: { label: 'Tích điểm mua tại cửa hàng' },
  POINTS_EXPIRED: { label: 'Điểm hết hạn' },
  XU_TO_POINTS: { label: 'Chuyển từ xu cũ sang Điểm Xanh' },
  REFERRAL_ORDER2: REFERRAL_REWARD,
  REFERRAL_MILESTONE: REFERRAL_REWARD,
  REFERRAL_ORDER2_REVOKE: REFERRAL_REVOKED,
  REFERRAL_MILESTONE_REVOKE: REFERRAL_REVOKED,
  REFERRAL_ORDER2_DEBT: REFERRAL_DEBT,
  REFERRAL_MILESTONE_DEBT: REFERRAL_DEBT,
  COMMUNITY_POST: COMMUNITY_REWARD,
  COMMUNITY_ANSWER: COMMUNITY_REWARD,
  COMMUNITY_BEST: COMMUNITY_REWARD,
  COMMUNITY_EVENT_WIN: COMMUNITY_REWARD,
  STOREFRONT_QUEST: { label: 'Thưởng nhiệm vụ gian hàng' },
  CTV_MILESTONE: { label: 'Thưởng mốc doanh số CTV' },
  GAME_BUY_TREE: { label: 'Góp quỹ trồng cây' },
  GAME_SPIN_COST: { label: 'Quay vòng quay may mắn' },
  GAME_SPIN_WIN: GARDEN_REWARD,
  SEASONPASS: GARDEN_REWARD,
  MISSION: { label: 'Thưởng nhiệm vụ Vườn Xanh' },
  REVIEW: { label: 'Đánh giá sản phẩm' },
  REVIEW_DELETE: { label: 'Thu hồi điểm đánh giá đã xoá' },
};

const FALLBACK_POINTS_LABEL = 'Điều chỉnh Điểm Xanh';

function familyRule(code: string): ReasonRule | undefined {
  if (code.startsWith('REFERRAL')) {
    if (code.includes('DEBT')) return REFERRAL_DEBT;
    return code.includes('REVOKE') ? REFERRAL_REVOKED : REFERRAL_REWARD;
  }
  if (code.startsWith('COMMUNITY')) return COMMUNITY_REWARD;
  if (code.startsWith('GAME') || code.startsWith('SEASONPASS')) return GARDEN_REWARD;
  if (code.startsWith('REVIEW')) return POINTS_REASON_RULES.REVIEW;
  return Object.entries(POINTS_REASON_RULES).find(([key]) => code.startsWith(key))?.[1];
}

/** Gộp phiên khách vãng lai đổi khoá một số dòng thành `MERGED:<id>:<reason cũ>` (auth.service); bỏ tiền tố để tra nhãn. */
function parsePointsReason(reason: string): { rule: ReasonRule | undefined; ref: string } {
  const core = reason.replace(/^MERGED:[^:]+:/, '');
  const sep = core.indexOf(':');
  const code = sep < 0 ? core : core.slice(0, sep);
  const ref = sep < 0 ? '' : core.slice(sep + 1);
  return { rule: POINTS_REASON_RULES[code] ?? familyRule(code), ref };
}

/** `reason` của dòng sổ Điểm Xanh có dạng "MÃ:tham-chiếu"; chỉ mã đầu quyết định nhãn. */
export function pointsReasonLabel(reason: string): string {
  return parsePointsReason(reason).rule?.label ?? FALLBACK_POINTS_LABEL;
}

const ORDER_CODE = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * Nhãn kèm tham chiếu cho màn quản trị tra cứu khiếu nại điểm: mã đơn ở các dòng ORDER_… và RETURN_…, "ngày n" ở điểm danh.
 * Phần tham chiếu không đúng dạng thì bỏ, không in chuỗi lạ ra màn hình.
 */
export function pointsReasonDetail(reason: string): string {
  const { rule, ref } = parsePointsReason(reason);
  if (!rule) return FALLBACK_POINTS_LABEL;
  if (rule.ref === 'order' && ORDER_CODE.test(ref)) return `${rule.label} · ${ref}`;
  if (rule.ref === 'day') {
    const day = /^DAY_(\d{1,3})$/.exec(ref);
    if (day) return `${rule.label} · ngày ${Number(day[1])}`;
  }
  return rule.label;
}

const WALLET_TX_LABELS: Record<string, string> = {
  OPENING: 'Số dư đầu kỳ',
  ORDER_PAY: 'Thanh toán đơn hàng',
  ORDER_REFUND: 'Hoàn tiền đơn hàng',
  COMMISSION_PAYOUT: 'Hoa hồng CTV về Ví',
  CASHBACK: 'Hoàn tiền sàn ngoài',
  WITHDRAW: 'Rút về ngân hàng',
  WITHDRAW_REFUND: 'Hoàn lệnh rút bị từ chối',
  XU_CONVERT: 'Đổi sang xu cũ (nay là Điểm Xanh)',
  MERGE_IN: 'Chuyển từ phiên mua khách',
  MERGE_OUT: 'Chuyển sang tài khoản chính',
  ADJUST: 'Điều chỉnh',
};

/** Nhãn dòng sao kê Ví theo loại biến động; loại API mới thêm mà web chưa biết vẫn hiện được. */
export function walletTxLabel(type: string): string {
  return WALLET_TX_LABELS[type] ?? 'Biến động ví';
}
