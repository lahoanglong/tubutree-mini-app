import { foldVietnamese } from '../catalog/search-text';
import type { ChatConfig } from './external-chat.config';
import type { PancakeCreatorRef } from './external-order.mapper';
import { claimPoints } from './external-points-rate';

const DAY_MS = 864e5;
const LOCAL_MOBILE = /^0\d{9}$/;
/** Status 16 của Pancake (đã thu tiền): có thể lên đơn không qua đối tác vận chuyển nhưng đã có tiền thật. */
const CARRIER_PAID_STATUS = 16;

export type ChatSkipReason = 'DISABLED' | 'NO_PHONE' | 'CLOSED' | 'NO_CARRIER' | 'BEFORE_SINCE' | 'TOO_OLD' | 'ZERO_POINTS';

export interface ChatOrderFacts {
  status: 'OPEN' | 'DELIVERED' | 'RETURNING' | 'RETURNED' | 'CANCELLED' | 'PARTIAL_RETURN' | 'DELETED';
  pancakeStatus: number | null;
  hasExtendCode: boolean;
  /** Đơn có mã vận đơn nào (kể cả ngoài extend_code). */
  hasTrackingCode: boolean;
  goodsValue: number | null;
  insertedAt: Date;
  phone: string | null;
}

export interface ChatMemberFacts {
  id: string;
  /** Vai STAFF hoặc ADMIN. */
  isStaff: boolean;
  /** `MembershipTier.pointMultiplier` của hạng hiện tại, 1 khi chưa có hạng. */
  tierMultiplier: number;
  /** SĐT khớp nhưng `phoneVerifiedAt` đã cũ hay chưa có: số có thể đã đổi chủ, người nhận phải được kiểm. */
  phoneStale?: boolean;
}

export interface ChatClaimFacts {
  now: Date;
  cfg: ChatConfig;
  order: ChatOrderFacts;
  /** Thành viên (đã quy về tài khoản gốc) có SĐT trùng SĐT đơn; null = chưa là thành viên. */
  member: ChatMemberFacts | null;
  /** SĐT đơn trùng SĐT của một nhân viên (tài khoản STAFF/ADMIN hay grant còn hiệu lực), kể cả nhân viên chưa là thành viên. */
  phoneIsStaff: boolean;
  /** Điểm các claim chat còn hiệu lực của cùng SĐT trong tháng VN này (không gồm claim đang xét). */
  monthPoints: number;
  /** Người tạo đơn trên Pancake (qua pancake.staff_map) chính là thành viên nhận điểm. */
  creatorIsMember?: boolean;
  /** Điểm đã tự cộng (không qua REVIEW) tháng này cho đơn của cùng người tạo; null = payload không có creator.id nên không áp trần. */
  creatorMonthPoints?: number | null;
}

export type ChatDecision =
  | { kind: 'SKIP'; reason: ChatSkipReason }
  | { kind: 'CLAIM'; state: 'PENDING' | 'REVIEW'; reviewReason: string | null; points: number; multiplier: number; ratePct: number; userId: string | null };

/** Lý do hiển thị cho nhân viên khi một claim bị kiểm lại lúc liên kết mà không còn đủ điều kiện (SKIP). */
export const CHAT_SKIP_TEXT: Record<ChatSkipReason, string> = {
  DISABLED: 'Tính năng tích điểm đơn chat đang tắt',
  NO_PHONE: 'Đơn không còn SĐT',
  CLOSED: 'Đơn đã đóng (huỷ, hoàn hay xoá)',
  NO_CARRIER: 'Đơn không có vận đơn',
  BEFORE_SINCE: 'Đơn tạo trước mốc bắt đầu tích điểm',
  TOO_OLD: 'Đơn quá tuổi tối đa để tích điểm',
  ZERO_POINTS: 'Đơn tính ra 0 điểm',
};

/** Đơn có `partner.extend_code` (đã có vận đơn) hoặc status 16. Đọc lỏng: payload sai kiểu coi như không có. */
export function chatCarrierOk(payload: Record<string, unknown> | null | undefined, pancakeStatus: number | null): boolean {
  if (pancakeStatus === CARRIER_PAID_STATUS) return true;
  const partner = payload?.['partner'];
  if (!partner || typeof partner !== 'object') return false;
  const code = (partner as Record<string, unknown>)['extend_code'];
  return typeof code === 'string' && code.trim() !== '';
}

/**
 * Quyết định tạo claim PHONE cho một đơn chat/điện thoại (HÀM THUẦN). Thứ tự: cờ, có SĐT, đơn chưa đóng, có vận đơn, mốc
 * external_since và tuổi đơn, điểm bằng 0; rồi REVIEW (thiếu tiền hàng, nhân viên tự tích, vượt ngưỡng, đơn hoàn một phần, vượt trần
 * tháng) hoặc PENDING. Thành viên nhân hệ số hạng hiện tại; chưa là thành viên thì hệ số 1 (người đó chưa có hạng).
 */
export function evaluateChatClaim(f: ChatClaimFacts): ChatDecision {
  const skip = (reason: ChatSkipReason): ChatDecision => ({ kind: 'SKIP', reason });
  const { cfg, order } = f;
  if (!cfg.enabled) return skip('DISABLED');
  if (!order.phone) return skip('NO_PHONE');
  if (order.status === 'CANCELLED' || order.status === 'RETURNED' || order.status === 'DELETED') return skip('CLOSED');
  if (cfg.requireCarrier && !order.hasExtendCode && order.pancakeStatus !== CARRIER_PAID_STATUS) return skip('NO_CARRIER');
  if (cfg.externalSince && order.insertedAt.getTime() < cfg.externalSince.getTime()) return skip('BEFORE_SINCE');
  if (f.now.getTime() - order.insertedAt.getTime() > cfg.maxAgeDays * DAY_MS) return skip('TOO_OLD');

  const multiplier = f.member ? f.member.tierMultiplier : 1;
  const points = claimPoints(order.goodsValue, cfg.earnPct, multiplier);
  if (points !== null && points === 0) return skip('ZERO_POINTS');

  let reviewReason: string | null = null;
  if (points === null) reviewReason = 'Chưa tính được tiền hàng của đơn';
  else if (f.member?.phoneStale) reviewReason = 'SĐT xác minh đã cũ, cần kiểm người nhận';
  else if (f.member?.isStaff) reviewReason = 'Thành viên là nhân viên Tubu Tree, cần người khác duyệt';
  else if (f.phoneIsStaff) reviewReason = 'SĐT trên đơn trùng SĐT của một nhân viên Tubu Tree, cần người khác duyệt';
  else if (f.creatorIsMember) reviewReason = 'Người tạo đơn trên Pancake chính là thành viên nhận điểm, cần người khác duyệt';
  else if (cfg.requireCarrier && order.pancakeStatus === CARRIER_PAID_STATUS && !order.hasExtendCode && !order.hasTrackingCode) {
    reviewReason = 'Đơn ở trạng thái 16 nhưng không có vận đơn (giao không qua vận chuyển), cần kiểm';
  }
  else if ((order.goodsValue ?? 0) > cfg.reviewAboveVnd) reviewReason = 'Giá trị đơn vượt ngưỡng tự duyệt';
  else if (order.status === 'PARTIAL_RETURN') reviewReason = 'Đơn đã hoàn một phần, cần nhân viên kiểm';
  else if (f.monthPoints + points > cfg.monthlyPointsCap) reviewReason = 'Vượt trần điểm tháng của SĐT này, cần nhân viên kiểm';
  else if (f.creatorMonthPoints != null && f.creatorMonthPoints + points > cfg.creatorMonthlyPoints) {
    reviewReason = 'Vượt trần điểm tự cộng tháng của người tạo đơn trên Pancake, cần nhân viên kiểm';
  }
  return {
    kind: 'CLAIM',
    state: reviewReason ? 'REVIEW' : 'PENDING',
    reviewReason,
    points: points ?? 0,
    multiplier,
    ratePct: cfg.earnPct,
    userId: f.member?.id ?? null,
  };
}

/** Mốc điểm đáng lẽ được cộng của đơn đã giao: giao + loyalty.external_pending_days. */
export const releaseAtOf = (deliveredAt: Date, cfg: Pick<ChatConfig, 'pendingDays'>): Date => new Date(deliveredAt.getTime() + cfg.pendingDays * DAY_MS);

/** Hạn giữ điểm cho SĐT chưa là thành viên: mốc cộng + loyalty.chat_unclaimed_hold_days. Tính từ mốc cộng chứ không từ lúc cron chạy. */
export const holdUntilOf = (releaseAt: Date, cfg: Pick<ChatConfig, 'holdDays'>): Date => new Date(releaseAt.getTime() + cfg.holdDays * DAY_MS);

export type ChatDueAction = 'WAIT' | 'CREDIT' | 'HOLD' | 'LAPSE';

/**
 * Việc cần làm với claim PHONE theo đồng hồ: PENDING tới hạn thì cộng (có thành viên) hoặc giữ (chưa có); HELD_NO_MEMBER quá hạn giữ
 * thì LAPSE. Đơn hoàn một phần và đơn đóng do `applyStatusToClaim` và `releaseClaim` xử lý, không nằm ở đây.
 */
export function chatDueAction(
  claim: { state: 'PENDING' | 'HELD_NO_MEMBER'; userId: string | null; holdUntil: Date | null },
  order: { status: string; deliveredAt: Date | null },
  now: Date,
  cfg: Pick<ChatConfig, 'pendingDays'>,
): ChatDueAction {
  if (claim.state === 'HELD_NO_MEMBER') return claim.holdUntil !== null && claim.holdUntil.getTime() < now.getTime() ? 'LAPSE' : 'WAIT';
  if (order.status !== 'DELIVERED' || !order.deliveredAt) return 'WAIT';
  if (releaseAtOf(order.deliveredAt, cfg).getTime() > now.getTime()) return 'WAIT';
  return claim.userId ? 'CREDIT' : 'HOLD';
}

/**
 * SĐT của thành viên được phép tự liên kết điểm chat. `users.phone` chỉ được ghi từ số Zalo cấp qua getPhoneNumber (AuthService:
 * resolvePhoneNumber → normalizeZaloPhone; không có API hồ sơ nào cho khách gõ số). Số có thể đổi chủ (nhà mạng cấp lại) nên không đủ
 * là "từng xác minh": `phoneVerifiedAt` (lần Zalo gần nhất trả đúng số này) phải còn trong `maxDays`. Khách vãng lai (`guest_`), tài
 * khoản bị khoá hay đã gộp, và số sai dạng thì bỏ qua. Mọi đường liên kết đi qua hàm này (test external-chat-phone-source.spec.ts canh
 * chỗ ghi `phone`, nhưng không bắt được SQL tay).
 */
export function verifiedMemberPhone(
  u: { phone: string | null; phoneVerifiedAt: Date | null; zaloId: string | null; isBlocked: boolean; mergedIntoId: string | null },
  verify: { now: Date; maxDays: number },
): string | null {
  const phone = linkableMemberPhone(u);
  return phone && phoneVerifiedFresh(u.phoneVerifiedAt, verify) ? phone : null;
}

/**
 * SĐT của thành viên mà claim được phép GẮN vào (đủ điều kiện làm người nhận), không xét độ mới của mốc xác minh: số cũ vẫn gắn
 * claim vào thành viên đó nhưng chờ nhân viên kiểm (`ChatMemberFacts.phoneStale`), thay vì để claim mất chủ rồi hết hạn giữ.
 */
export function linkableMemberPhone(u: { phone: string | null; zaloId: string | null; isBlocked: boolean; mergedIntoId: string | null }): string | null {
  if (!u.phone || !LOCAL_MOBILE.test(u.phone)) return null;
  if (!u.zaloId || u.zaloId.startsWith('guest_')) return null;
  if (u.isBlocked || u.mergedIntoId) return null;
  return u.phone;
}

/** `phoneVerifiedAt` còn trong hạn (không có mốc = chưa từng xác minh). Mốc ở tương lai (lệch đồng hồ) vẫn tính là mới. */
export const phoneVerifiedFresh = (at: Date | null, verify: { now: Date; maxDays: number }): boolean =>
  at !== null && verify.now.getTime() - at.getTime() <= verify.maxDays * DAY_MS;

/**
 * Người duyệt có phải người tạo/phụ trách đơn trên Pancake không. Hai cách so: id tài khoản Pancake qua `pancake.staff_map` (chắc chắn,
 * khi chủ shop đã khai báo) và tên đã bỏ dấu (dự phòng, dễ lọt khi tên khác nhau).
 */
export function isSameAsPancakeCreator(
  approver: { id?: string; fullName: string | null },
  refs: readonly PancakeCreatorRef[],
  staffMap: ReadonlyMap<string, string> = new Map(),
): boolean {
  if (approver.id && refs.some((r) => r.id !== null && staffMap.get(r.id) === approver.id)) return true;
  if (!approver.fullName || refs.length === 0) return false;
  const name = foldVietnamese(approver.fullName);
  return name !== '' && refs.some((r) => r.name !== null && r.name === name);
}

/** Người tạo đơn trên Pancake (payload) quy ra userId nhân viên Tubu qua `pancake.staff_map`; null khi không có hay chưa khai báo. */
export function creatorStaffUserId(refs: readonly PancakeCreatorRef[], staffMap: ReadonlyMap<string, string>): string | null {
  for (const r of refs) {
    const id = r.id ? staffMap.get(r.id) : undefined;
    if (id) return id;
  }
  return null;
}
