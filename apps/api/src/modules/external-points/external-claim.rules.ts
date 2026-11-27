import type { ExternalClaimRejectCode } from '@tubutree/shared-types';
import type { ClaimConfig } from './external-claim.config';
import { claimPoints } from './external-points-rate';
import type { OrderPhoneMatch } from './order-phone-match';

const DAY_MS = 864e5;
export const NOT_FOUND_LOCK_THRESHOLD = 5;
/** Đơn sàn không có SĐT (đầy đủ hay che đủ số) để đối chiếu tự động: người kiểm xem đơn trước khi cộng. */
export const NO_PHONE_REVIEW_REASON = 'Đơn sàn không có thông tin SĐT để đối chiếu tự động';
export const PHONE_MISMATCH_REVIEW_REASON = 'SĐT trên đơn sàn không khớp SĐT thành viên';
/** Thành viên chỉ có SĐT liên hệ tự gõ trên Web (`phoneVerifiedAt = null`): luôn có người đối chiếu trước khi cộng (W45). */
export const WEB_UNVERIFIED_PHONE_REVIEW_REASON = 'SĐT đăng ký trên Web chưa xác thực Zalo — chờ CSKH đối chiếu';
const OWN_REPORTABLE = ['PENDING', 'REVIEW', 'HELD_NO_MEMBER', 'CREDITED'];

/** W46: số lần nhập sai 4 số cuối SĐT nhận hàng cho một đơn trong 24 giờ; tới mức này thì khoá xác nhận đơn đó 24 giờ. */
export const PHONE_CONFIRM_MAX_WRONG = 3;
/** Ghi ở sổ claim (và lý do REVIEW khi SĐT chưa xác minh) khi claim được tạo nhờ khách nhập đúng 4 số cuối SĐT người nhận. */
export const PHONE_CONFIRMED_NOTE = 'Xác nhận qua 4 số cuối SĐT nhận hàng';
/** Kết quả lượt gửi mã (`external_claim_attempts.result`) của luồng xác nhận 4 số cuối. */
export const PHONE_CONFIRM_RESULTS = {
  /** Lượt đầu, chưa nhập 4 số: tính vào khoá 24h như PHONE_MISMATCH cũ, đổi thành CONFIRMED khi khách xác nhận đúng sau đó. */
  required: 'REJECTED_PHONE_CONFIRM_REQUIRED',
  /** Nhập sai: tính vào khoá 24h của khách và vào khoá 3 lần của đơn. */
  wrong: 'REJECTED_PHONE_CONFIRM_WRONG',
  /** Lượt bị chặn vì đơn đang khoá xác nhận: chỉ tính vào trần lần thử/ngày. */
  locked: 'REJECTED_PHONE_CONFIRM_LOCKED',
  /** Lượt REQUIRED cũ của đơn đã được chính khách đó xác nhận đúng: không còn tính vào khoá. */
  confirmed: 'PHONE_CONFIRMED',
} as const;

export interface ClaimOrderFacts {
  source: 'MARKETPLACE' | 'CHAT' | 'UNKNOWN';
  status: 'OPEN' | 'DELIVERED' | 'RETURNING' | 'RETURNED' | 'CANCELLED' | 'PARTIAL_RETURN' | 'DELETED';
  /** `inserted_at` của Pancake, rơi về lần đầu thấy đơn khi payload không có. */
  insertedAt: Date;
  goodsValue: number | null;
  /** SĐT trên đơn (đầy đủ hoặc đã che, order-phone-match.ts) so với SĐT Zalo của khách gửi mã. */
  phoneMatch: OrderPhoneMatch;
  /** Số chữ số SĐT đơn nhìn thấy khi so (11 = số đầy đủ). Vắng khi nhân viên đã gắn tay thay cho phép so. */
  phoneVisibleDigits?: number;
}

/** Mọi dữ kiện luật cần, đọc xong trong transaction đã giữ khoá advisory của khách. Hàm luật thuần nên thứ tự được kiểm bằng unit test. */
export interface ClaimFacts {
  now: Date;
  cfg: ClaimConfig;
  /** Khách thật, có SĐT (đã xác minh qua Zalo hoặc SĐT liên hệ tự gõ trên Web), không bị khoá. */
  userOk: boolean;
  /** SĐT đã xác minh qua Zalo (`phoneVerifiedAt`). false = SĐT liên hệ tự gõ trên Web. */
  phoneVerified: boolean;
  /** Có ít nhất một đơn mua trong app đã giao (chỉ cần khi SĐT chưa xác minh). */
  deliveredAppOrder: boolean;
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
  /**
   * W46: chỉ có ở lượt khách tự gửi mã. Vắng (cron ghép lại, nhân viên gắn tay) thì SĐT lệch vẫn là PHONE_MISMATCH như W42.
   * `last4` null = khách chưa nhập; `matches` = 4 số khớp SĐT người nhận trên đơn; `wrongTimes` = các lần nhập sai cho đơn này (48 giờ gần nhất).
   */
  phoneConfirm?: { last4: string | null; matches: boolean; wrongTimes: readonly Date[] };
}

export type ClaimDecision =
  /** `record`: ghi lần thử dù mã thuộc nhóm thường không ghi (UNRECORDED), để từ chối nằm sau bước tra đơn vẫn tính vào trần lần thử/ngày. */
  /**
   * `attemptResult`: kết quả ghi vào lần thử khi khác `REJECTED_<code>` (lần sai thứ 3 trả PHONE_CONFIRM_LOCKED nhưng vẫn là một lần sai).
   * `remainingAttempts`: lần nhập sai 4 số cuối còn được (chỉ PHONE_CONFIRM_*).
   */
  | { kind: 'REJECT'; code: ExternalClaimRejectCode; record?: true; attemptResult?: string; remainingAttempts?: number }
  | { kind: 'UNMATCHED' }
  | { kind: 'UNKNOWN_SOURCE' }
  | { kind: 'OWN_CLAIM'; claimId: string; state: string }
  /** `phoneConfirmed`: SĐT tài khoản khác SĐT trên đơn, khách đã nhập đúng 4 số cuối SĐT người nhận (W46). */
  | { kind: 'CLAIM'; state: 'PENDING' | 'REVIEW'; reviewReason: string | null; points: number; phoneConfirmed?: true };

/**
 * Khoá 24h sau 5 lần gửi mã không tìm thấy. Khoá tính từ lần thứ 5 (lần mới nhất trong chuỗi): lúc đó ba lần gần nhất cộng với lần
 * này đã đủ 5 trong cửa sổ 24h. Khi đang khoá thì không ghi thêm lần thử, nên lần mới nhất đứng yên và khoá tự hết sau đúng 24h.
 */
export function lockedUntil(notFoundTimes: readonly Date[], now: Date, threshold: number = NOT_FOUND_LOCK_THRESHOLD): Date | null {
  if (notFoundTimes.length < threshold) return null;
  const sorted = [...notFoundTimes].sort((a, b) => b.getTime() - a.getTime());
  const newest = sorted[0]!.getTime();
  const inWindow = sorted.filter((t) => newest - t.getTime() < DAY_MS).length;
  if (inWindow < threshold) return null;
  const until = new Date(newest + DAY_MS);
  return until.getTime() > now.getTime() ? until : null;
}

/**
 * Thứ tự luật của một lần gửi mã (extpoints-plan, bước 2): cờ và loại khách, khoá 24h, lần thử trong ngày, mã trùng đơn trong
 * app, có đơn không (UNMATCHED), loại đơn (chat từ chối, lạ vào hàng admin), SĐT trên đơn lệch SĐT khách (W42), mốc external_since
 * và tuổi đơn, trạng thái đơn, mã đã được tích, trần claim/ngày, trần điểm/tháng, cuối cùng REVIEW hay PENDING. Luật đứng trước thắng.
 *
 * PHONE_MISMATCH đứng ngay sau loại đơn: người cầm mã của người khác không dò được đơn đó đã huỷ, đã tích hay quá hạn. Claim của chính
 * khách (gửi lại mã đã có) không bị chặn ở đây để khách vẫn xem được trạng thái claim cũ dù đã đổi SĐT.
 *
 * SĐT liên hệ tự gõ trên Web, chưa xác minh qua Zalo (W45): chỉ đi tiếp khi SĐT trên đơn khớp SĐT đó, hoặc khách đã có đơn mua trong app giao
 * thành công; claim luôn vào REVIEW để CSKH đối chiếu. Không thoả thì NOT_ELIGIBLE_USER, có ghi lần thử (đã tra đơn nên phải tính vào trần).
 */
/**
 * SĐT tự gõ trên Web do chính khách chọn, nên MATCH với đơn che còn 2 số cuối chỉ là trùng 1/100: nói rõ đã khớp bao nhiêu số để CSKH không
 * coi đó là bằng chứng chủ đơn.
 */
function unverifiedMatchNote(order: ClaimOrderFacts, phoneConfirmed: boolean): string | null {
  if (phoneConfirmed) return PHONE_CONFIRMED_NOTE;
  if (order.phoneMatch !== 'MATCH' || order.phoneVisibleDigits === undefined) return null;
  return order.phoneVisibleDigits > 10 ? 'SĐT tự nhập khớp số đầy đủ trên đơn sàn' : `SĐT tự nhập chỉ khớp ${order.phoneVisibleDigits}/10 chữ số nhìn thấy trên đơn sàn`;
}

/**
 * W46 (PO A1): SĐT tài khoản lệch SĐT trên đơn thì khách xác nhận bằng 4 số cuối SĐT người nhận thay vì bị chặn hẳn. Trả quyết định từ chối,
 * hoặc null khi khách đã xác nhận đúng (đi tiếp các luật sau như đơn khớp SĐT). Đơn đang khoá (đủ 3 lần sai trong 24 giờ) thì chặn trước
 * mọi thứ, kể cả lần nhập đúng.
 */
function phoneConfirmStep(pc: NonNullable<ClaimFacts['phoneConfirm']>, now: Date): ClaimDecision | null {
  const locked = { kind: 'REJECT' as const, code: 'PHONE_CONFIRM_LOCKED' as const, remainingAttempts: 0 };
  if (lockedUntil(pc.wrongTimes, now, PHONE_CONFIRM_MAX_WRONG)) return { ...locked, attemptResult: PHONE_CONFIRM_RESULTS.locked };
  if (pc.last4 === null) return { kind: 'REJECT', code: 'PHONE_CONFIRM_REQUIRED', attemptResult: PHONE_CONFIRM_RESULTS.required };
  if (pc.matches) return null;
  const used = pc.wrongTimes.filter((t) => now.getTime() - t.getTime() < DAY_MS).length + 1;
  const remainingAttempts = Math.max(0, PHONE_CONFIRM_MAX_WRONG - used);
  if (remainingAttempts === 0) return { ...locked, attemptResult: PHONE_CONFIRM_RESULTS.wrong };
  return { kind: 'REJECT', code: 'PHONE_CONFIRM_WRONG', attemptResult: PHONE_CONFIRM_RESULTS.wrong, remainingAttempts };
}

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
  let phoneConfirmed = false;
  if (order.phoneMatch === 'MISMATCH' && !f.claim?.own) {
    if (!f.phoneConfirm) return reject('PHONE_MISMATCH');
    const step = phoneConfirmStep(f.phoneConfirm, f.now);
    if (step) return step;
    phoneConfirmed = true;
  }
  const phoneOk = order.phoneMatch === 'MATCH' || phoneConfirmed;
  if (!f.phoneVerified && !phoneOk && !f.deliveredAppOrder && !f.claim?.own) return { kind: 'REJECT', code: 'NOT_ELIGIBLE_USER', record: true };

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
  else if (order.phoneMatch === 'NO_DATA') reviewReason = NO_PHONE_REVIEW_REASON;
  // Chỉ claim của chính khách (mã được mở lại) qua được tới đây khi SĐT lệch: người duyệt phải thấy lý do lệch, vì duyệt xong thì lúc
  // cộng không kiểm lại SĐT.
  // Khách đã xác nhận 4 số cuối SĐT người nhận (W46) thì SĐT lệch không còn là lý do chờ duyệt: claim vào PENDING như đơn khớp SĐT.
  if (order.phoneMatch === 'MISMATCH' && !phoneConfirmed) reviewReason = [PHONE_MISMATCH_REVIEW_REASON, reviewReason].filter(Boolean).join('; ');
  if (!f.phoneVerified) reviewReason = [WEB_UNVERIFIED_PHONE_REVIEW_REASON, unverifiedMatchNote(order, phoneConfirmed), reviewReason].filter(Boolean).join('; ');
  return { kind: 'CLAIM', state: reviewReason ? 'REVIEW' : 'PENDING', reviewReason, points: points ?? 0, ...(phoneConfirmed ? { phoneConfirmed: true as const } : {}) };
}

/**
 * Điểm chốt khi tiền hàng tăng làm điểm tính lại vượt trần tháng: không bao giờ thấp hơn điểm đã qua kiểm, không vượt điểm mới, và
 * không vượt phần trần còn lại. `others` là điểm các claim khác trong tháng (không gồm claim này, để không trừ hai lần).
 */
export function settlePoints(a: { newPoints: number; checkedPoints: number; others: number; cap: number }): number {
  return Math.min(a.newPoints, Math.max(a.checkedPoints, a.cap - a.others));
}
