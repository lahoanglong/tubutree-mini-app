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
}

export type ChatDecision =
  | { kind: 'SKIP'; reason: ChatSkipReason }
  | { kind: 'CLAIM'; state: 'PENDING' | 'REVIEW'; reviewReason: string | null; points: number; multiplier: number; ratePct: number; userId: string | null };

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
  else if (f.member?.isStaff) reviewReason = 'Thành viên là nhân viên Tubu Tree, cần người khác duyệt';
  else if (f.phoneIsStaff) reviewReason = 'SĐT trên đơn trùng SĐT của một nhân viên Tubu Tree, cần người khác duyệt';
  else if ((order.goodsValue ?? 0) > cfg.reviewAboveVnd) reviewReason = 'Giá trị đơn vượt ngưỡng tự duyệt';
  else if (order.status === 'PARTIAL_RETURN') reviewReason = 'Đơn đã hoàn một phần, cần nhân viên kiểm';
  else if (f.monthPoints + points > cfg.monthlyPointsCap) reviewReason = 'Vượt trần điểm tháng của SĐT này, cần nhân viên kiểm';
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
 * resolvePhoneNumber → normalizeZaloPhone; không có API hồ sơ nào cho khách gõ số), nên một tài khoản Zalo thật có `phone` là số đã
 * xác minh. Khách vãng lai (`guest_`), tài khoản bị khoá hay đã gộp, và số sai dạng thì bỏ qua. Mọi đường liên kết đi qua hàm này;
 * nếu sau này có đường cho khách tự gõ số thì PHẢI thêm cờ xác minh ở đây (test external-chat-phone-source.spec.ts canh chỗ ghi `phone`).
 */
export function verifiedMemberPhone(u: { phone: string | null; zaloId: string | null; isBlocked: boolean; mergedIntoId: string | null }): string | null {
  if (!u.phone || !LOCAL_MOBILE.test(u.phone)) return null;
  if (!u.zaloId || u.zaloId.startsWith('guest_')) return null;
  if (u.isBlocked || u.mergedIntoId) return null;
  return u.phone;
}

/** Người duyệt có phải người tạo/phụ trách đơn trên Pancake không (so tên đã bỏ dấu: repo chưa có ánh xạ nhân viên Tubu với tài khoản Pancake). */
export function isSameAsPancakeCreator(approver: { fullName: string | null }, refs: readonly PancakeCreatorRef[]): boolean {
  if (!approver.fullName || refs.length === 0) return false;
  const name = foldVietnamese(approver.fullName);
  return name !== '' && refs.some((r) => r.name !== null && r.name === name);
}
