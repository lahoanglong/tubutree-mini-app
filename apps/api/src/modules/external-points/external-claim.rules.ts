import type { ExternalClaimRejectCode } from '@tubutree/shared-types';
import type { ClaimConfig } from './external-claim.config';
import { claimPoints } from './external-points-rate';

const DAY_MS = 864e5;
export const NOT_FOUND_LOCK_THRESHOLD = 5;
const OWN_REPORTABLE = ['PENDING', 'REVIEW', 'HELD_NO_MEMBER', 'CREDITED'];

export interface ClaimOrderFacts {
  source: 'MARKETPLACE' | 'CHAT' | 'UNKNOWN';
  status: 'OPEN' | 'DELIVERED' | 'RETURNING' | 'RETURNED' | 'CANCELLED' | 'PARTIAL_RETURN' | 'DELETED';
  /** `inserted_at` của Pancake, rơi về lần đầu thấy đơn khi payload không có. */
  insertedAt: Date;
  goodsValue: number | null;
  phoneLast3: string | null;
}

/** Mọi dữ kiện luật cần, đọc xong trong transaction đã giữ khoá advisory của khách. Hàm luật thuần nên thứ tự được kiểm bằng unit test. */
export interface ClaimFacts {
  now: Date;
  cfg: ClaimConfig;
  userOk: boolean;
  userPhoneLast3: string | null;
  /** Thành viên là nhân viên hoặc admin: tự tích điểm cho mình thì luôn phải có người khác duyệt. */
  userIsStaff: boolean;
  lockedUntil: Date | null;
  attemptsToday: number;
  isAppOrder: boolean;
  order: ClaimOrderFacts | null;
  /** Claim đã có trên đơn này. `reopenable` = admin đã "Huỷ và mở lại mã" nên nhận lại được. `own` = claim của chính khách đang gửi. */
  claim: { id: string; reopenable: boolean; own: boolean; state: string } | null;
  /** Đơn KHÁC (cùng mã vận đơn hoặc mã đơn sàn) đã có claim còn hiệu lực: một mã chỉ tích một lần dù Pancake tách thành nhiều dòng. */
  codeTaken: boolean;
  claimsToday: number;
  /** Tổng điểm các claim còn hiệu lực tạo trong tháng VN này của khách. */
  monthPoints: number;
}

export type ClaimDecision =
  | { kind: 'REJECT'; code: ExternalClaimRejectCode }
  | { kind: 'UNMATCHED' }
  | { kind: 'UNKNOWN_SOURCE' }
  | { kind: 'OWN_CLAIM'; claimId: string; state: string }
  | { kind: 'CLAIM'; state: 'PENDING' | 'REVIEW'; reviewReason: string | null; points: number };

/**
 * Khoá 24h sau 5 lần gửi mã không tìm thấy. Khoá tính từ lần thứ 5 (lần mới nhất trong chuỗi): lúc đó ba lần gần nhất cộng với lần
 * này đã đủ 5 trong cửa sổ 24h. Khi đang khoá thì không ghi thêm lần thử, nên lần mới nhất đứng yên và khoá tự hết sau đúng 24h.
 */
export function lockedUntil(notFoundTimes: readonly Date[], now: Date): Date | null {
  if (notFoundTimes.length < NOT_FOUND_LOCK_THRESHOLD) return null;
  const sorted = [...notFoundTimes].sort((a, b) => b.getTime() - a.getTime());
  const newest = sorted[0]!.getTime();
  const inWindow = sorted.filter((t) => newest - t.getTime() < DAY_MS).length;
  if (inWindow < NOT_FOUND_LOCK_THRESHOLD) return null;
  const until = new Date(newest + DAY_MS);
  return until.getTime() > now.getTime() ? until : null;
}

/**
 * Thứ tự luật của một lần gửi mã (extpoints-plan, bước 2): cờ và loại khách, khoá 24h, lần thử trong ngày, mã trùng đơn trong
 * app, có đơn không (UNMATCHED), loại đơn (chat từ chối, lạ vào hàng admin), mốc external_since và tuổi đơn, trạng thái đơn, mã
 * đã được tích, trần claim/ngày, trần điểm/tháng, cuối cùng REVIEW hay PENDING. Luật đứng trước thắng.
 */
export function evaluateClaimRules(f: ClaimFacts): ClaimDecision {
  const reject = (code: ExternalClaimRejectCode): ClaimDecision => ({ kind: 'REJECT', code });
  if (!f.cfg.enabled) return reject('DISABLED');
  if (!f.userOk) return reject('NOT_ELIGIBLE_USER');
  if (f.lockedUntil && f.lockedUntil.getTime() > f.now.getTime()) return reject('LOCKED');
  if (f.attemptsToday >= f.cfg.dailyAttempts) return reject('DAILY_ATTEMPTS');
  if (f.isAppOrder) return reject('APP_ORDER');
  const order = f.order;
  if (!order) return { kind: 'UNMATCHED' };
  if (order.source === 'CHAT') return reject('CHAT_ORDER');
  if (order.source === 'UNKNOWN') return { kind: 'UNKNOWN_SOURCE' };

  if (f.cfg.externalSince && order.insertedAt.getTime() < f.cfg.externalSince.getTime()) return reject('BEFORE_SINCE');
  if (f.now.getTime() - order.insertedAt.getTime() > f.cfg.maxAgeDays * DAY_MS) return reject('TOO_OLD');
  if (order.status === 'CANCELLED' || order.status === 'RETURNED' || order.status === 'DELETED') return reject('CLOSED');
  if (f.claim && !f.claim.reopenable) {
    // Gửi lại mã của chính mình chỉ trả trạng thái hiện có, không tính là lần thử. Claim đã đóng (huỷ, đảo) thì vẫn là "đã tích".
    if (f.claim.own && OWN_REPORTABLE.includes(f.claim.state)) return { kind: 'OWN_CLAIM', claimId: f.claim.id, state: f.claim.state };
    return reject('ALREADY_CLAIMED');
  }
  if (f.codeTaken) return reject('ALREADY_CLAIMED');
  if (f.claimsToday >= f.cfg.dailyMax) return reject('DAILY_MAX');

  const points = claimPoints(order.goodsValue, f.cfg.earnPct);
  if (points !== null && points === 0) return reject('ZERO_POINTS');
  if (points !== null && f.monthPoints + points > f.cfg.monthlyPointsCap) return reject('MONTHLY_CAP');

  let reviewReason: string | null = null;
  if (points === null) reviewReason = 'Chưa tính được tiền hàng của đơn';
  else if (f.claim?.reopenable) reviewReason = 'Mã được nhân viên mở lại, cần người khác duyệt';
  else if (f.userIsStaff) reviewReason = 'Thành viên là nhân viên Tubu Tree, cần người khác duyệt';
  else if (order.status === 'PARTIAL_RETURN') reviewReason = 'Đơn đã hoàn một phần trên sàn, cần nhân viên kiểm';
  else if ((order.goodsValue ?? 0) > f.cfg.reviewAboveVnd) reviewReason = 'Giá trị đơn vượt ngưỡng tự duyệt';
  else if (order.phoneLast3 && f.userPhoneLast3 && order.phoneLast3 !== f.userPhoneLast3) reviewReason = '3 số cuối SĐT trên đơn khác SĐT thành viên';
  return { kind: 'CLAIM', state: reviewReason ? 'REVIEW' : 'PENDING', reviewReason, points: points ?? 0 };
}

/**
 * Điểm chốt khi tiền hàng tăng làm điểm tính lại vượt trần tháng: không bao giờ thấp hơn điểm đã qua kiểm, không vượt điểm mới, và
 * không vượt phần trần còn lại. `others` là điểm các claim khác trong tháng (không gồm claim này, để không trừ hai lần).
 */
export function settlePoints(a: { newPoints: number; checkedPoints: number; others: number; cap: number }): number {
  return Math.min(a.newPoints, Math.max(a.checkedPoints, a.cap - a.others));
}
