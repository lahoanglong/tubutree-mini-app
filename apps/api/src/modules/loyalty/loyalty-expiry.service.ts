import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CRON_TZ } from '../../common/cron-tz';
import { formatVnDate } from '../../common/vn-time';
import {
  MILESTONE_PREFIX,
  MILESTONE_REVOKE_PREFIX,
  REFERRAL_ORDER2_PREFIX,
  REFERRAL_ORDER2_REVOKE_PREFIX,
} from '../wallet/referral-reward';

const DAY = 864e5;
const BATCH = 500; // kích thước mỗi trang candidate.
// Trần số trang — phòng vòng lặp vô tận nếu truy vấn sai (mirror LoyaltyService.RECALC_MAX_PAGES).
// 500 × 2.000 = 1.000.000 user/lượt, đủ cho mọi quy mô thực tế.
const MAX_PAGES = 2_000;

/** Shape tối giản của PointsTransaction mà helper thuần cần. */
export interface PointExpiryTxn {
  id: string;
  delta: number;
  expiresAt: Date | null;
  createdAt: Date;
  reason?: string;
  refType?: string | null;
  refId?: string | null;
}

export interface PointExpiryResult {
  /** Điểm đã hết hạn ngay bây giờ (còn tồn trong các lô hết hạn, chưa bị tiêu). */
  expiredNow: number;
  /** Điểm sắp hết hạn trong cửa sổ nhắc + mốc hết hạn sớm nhất. */
  expiringSoon: { amount: number; earliestExpiresAt: Date | null };
}

/**
 * `reason` của dòng cron trừ điểm hết hạn (xem LoyaltyExpiryService.expireUser).
 *
 * computePointExpiry replay dòng này vào các lô có `expiresAt <= createdAt` của nó, nên `createdAt` PHẢI
 * không sớm hơn `now` mà cron dùng để chọn lô hết hạn. Điều đó đúng nhờ `@default(now())`: client Prisma gán
 * giờ máy ứng dụng lúc INSERT (không phải lúc mở transaction), luôn sau `now` của lượt chạy. Đặt createdAt
 * sớm hơn thì lô vừa hết hạn không bị dòng này ăn, phần trừ rơi vào lô khác và đêm sau cron trừ lần hai.
 */
const EXPIRY_REASON = 'POINTS_EXPIRED';

/**
 * Dòng âm có hai nghĩa khác nhau với sổ lô. TIÊU (dùng điểm cho đơn, đổi voucher, góp quỹ cây, quay thưởng) lấy điểm
 * từ lô cũ nhất. ĐẢO NGƯỢC một khoản cộng cụ thể (thu hồi điểm đã thưởng) phải lấy đúng lô của khoản cộng đó; nếu
 * để FIFO ăn lô cũ nhất thì lô gốc (có hạn) vẫn còn nguyên trong sổ, tới hạn cron trừ lại đúng số điểm đã thu hồi và
 * khách mất điểm hai lần khi còn lô cũ hơn (không hạn, hoặc hết hạn muộn hơn).
 *
 * Mỗi quy tắc dưới đây ghép một dòng cộng với dòng thu hồi nó bằng cùng một khoá. Dòng cộng không có khoá, hoặc dòng
 * âm có khoá nhưng không còn lô cùng khoá, thì đi FIFO như dòng tiêu. Dòng âm không khớp quy tắc nào luôn là dòng tiêu.
 * Khớp theo refType và refId khi sổ cho phép; khi cùng refId có nhiều lô dương hay khi dòng thu hồi mang refId khác
 * dòng thưởng thì khớp thêm theo tiền tố reason, vốn đã là hợp đồng của sổ (partial unique index theo reason).
 */
interface ReversalRule {
  /** Khoá lô mà dòng DƯƠNG này tạo ra; null nếu dòng này không thể bị thu hồi theo quy tắc. */
  lotKey(t: PointExpiryTxn): string | null;
  /** Khoá lô gốc mà dòng ÂM này thu hồi; null nếu dòng âm này là dòng tiêu. */
  reversedLotKey(t: PointExpiryTxn): string | null;
}

/** Khoá lô của điểm đơn giao (ORDER_DELIVERED) và của điểm thưởng đánh giá; luật ghép nằm ở ORDER_RULE, REVIEW_RULE. */
export const orderLotKey = (orderId: string): string => `ORDER:${orderId}`;
export const reviewLotKey = (reviewId: string): string => `REVIEW:${reviewId}`;

const startsWith = (value: string | undefined, prefix: string): value is string => typeof value === 'string' && value.startsWith(prefix);

/**
 * Huỷ/trả đơn (LoyaltyService.reverseOrderPoints): ORDER_REVERSED:<mã> thu hồi điểm ORDER_DELIVERED:<mã> của cùng đơn
 * (cùng refType ORDER và refId = id đơn). Một đơn còn có dòng hoàn ORDER_REFUND_POINTS (dương) và dòng tiêu
 * ORDER_REDEEM (âm) mang cùng refId, nên chỉ ORDER_DELIVERED mới là lô gốc: dòng hoàn là khoản cộng mới có hạn riêng.
 */
const ORDER_RULE: ReversalRule = {
  lotKey: (t) => (t.refType === 'ORDER' && t.refId && startsWith(t.reason, 'ORDER_DELIVERED:') ? orderLotKey(t.refId) : null),
  reversedLotKey: (t) => (t.refType === 'ORDER' && t.refId && startsWith(t.reason, 'ORDER_REVERSED:') ? orderLotKey(t.refId) : null),
};

/** Xoá đánh giá (ReviewsService.remove): mọi dòng refType REVIEW mang refId = id đánh giá thuộc cùng một cặp. */
const REVIEW_RULE: ReversalRule = {
  lotKey: (t) => (t.refType === 'REVIEW' && t.refId ? reviewLotKey(t.refId) : null),
  reversedLotKey: (t) => (t.refType === 'REVIEW' && t.refId ? reviewLotKey(t.refId) : null),
};

/**
 * Thu hồi thưởng đơn thứ hai của người được mời (revokeReferralRewardForOrder): dòng thưởng mang refId "<đơn đầu>:<đơn
 * hai>" còn dòng thu hồi mang refId của đơn bị trả, nên không ghép theo refId được. Hai dòng chung hậu tố reason
 * `<id người được mời>`: REFERRAL_ORDER2:<id> và REFERRAL_ORDER2_REVOKE:<id>.
 */
const REFERRAL_ORDER2_RULE: ReversalRule = {
  lotKey: (t) => (t.refType === 'REFERRAL' && startsWith(t.reason, REFERRAL_ORDER2_PREFIX) ? `REFERRAL_ORDER2:${t.reason.slice(REFERRAL_ORDER2_PREFIX.length)}` : null),
  reversedLotKey: (t) =>
    t.refType === 'REFERRAL' && startsWith(t.reason, REFERRAL_ORDER2_REVOKE_PREFIX)
      ? `REFERRAL_ORDER2:${t.reason.slice(REFERRAL_ORDER2_REVOKE_PREFIX.length)}`
      : null,
};

/** Đời 0 không có hậu tố `#<đời>` ở dòng thưởng nhưng dòng thu hồi luôn có, nên cả hai quy về `<mốc>#<đời>`. */
function milestoneKey(rest: string): string | null {
  const [mark, generation, ...extra] = rest.split('#');
  const gen = generation === undefined || generation === '' ? 0 : Number(generation);
  if (!mark || extra.length > 0 || !Number.isInteger(gen) || gen < 0) return null;
  return `REFERRAL_MILESTONE:${mark}#${gen}`;
}

/**
 * Mốc thưởng thêm của người mời: thưởng REFERRAL_MILESTONE:<người mời>:<mốc>[#<đời>] (đời 0 không có hậu tố), thu hồi
 * REFERRAL_MILESTONE_REVOKE:<người mời>:<mốc>#<đời> (luôn có hậu tố). Cùng một mốc có thể đạt lại ở đời sau nên khoá
 * gồm cả đời; thu hồi đời n chỉ ăn lô của đời n. Tiền tố import từ referral-reward.ts để hai phía không lệch nhau.
 */
const REFERRAL_MILESTONE_RULE: ReversalRule = {
  lotKey: (t) => (t.refType === 'REFERRAL' && startsWith(t.reason, MILESTONE_PREFIX) ? milestoneKey(t.reason.slice(MILESTONE_PREFIX.length)) : null),
  reversedLotKey: (t) =>
    t.refType === 'REFERRAL' && startsWith(t.reason, MILESTONE_REVOKE_PREFIX) ? milestoneKey(t.reason.slice(MILESTONE_REVOKE_PREFIX.length)) : null,
};

const REVERSAL_RULES: readonly ReversalRule[] = [ORDER_RULE, REVIEW_RULE, REFERRAL_ORDER2_RULE, REFERRAL_MILESTONE_RULE];

function firstKey(t: PointExpiryTxn, pick: (rule: ReversalRule) => (t: PointExpiryTxn) => string | null): string | null {
  for (const rule of REVERSAL_RULES) {
    const key = pick(rule)(t);
    if (key) return key;
  }
  return null;
}

interface ExpiryLot {
  remaining: number;
  expiresAt: Date | null;
  /** Khoá cặp của khoản cộng đã tạo lô (xem ReversalRule); null nếu khoản cộng không thể bị thu hồi. */
  key: string | null;
}

/** Trừ `amount` từ các lô theo thứ tự mảng; trả phần chưa trừ được. */
function consumeFifo(lots: ExpiryLot[], amount: number): number {
  let left = amount;
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(lot.remaining, left);
    lot.remaining -= take;
    left -= take;
  }
  return left;
}

/**
 * Replay sổ lô STANDARD (HÀM THUẦN, tất định): mỗi delta DƯƠNG là một lô, mỗi delta ÂM tiêu dần từ các lô theo luật
 * của computePointExpiry. Trả các lô theo thứ tự tạo, kèm phần còn lại sau mọi dòng âm.
 */
function replayLots(txns: PointExpiryTxn[]): ExpiryLot[] {
  // Tất định: sort createdAt asc, tiebreak id asc (không phụ thuộc thứ tự đầu vào).
  const sorted = [...txns].sort((a, b) => {
    const t = a.createdAt.getTime() - b.createdAt.getTime();
    if (t !== 0) return t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const lots: ExpiryLot[] = [];
  for (const t of sorted) {
    if (t.delta > 0) {
      lots.push({ remaining: t.delta, expiresAt: t.expiresAt, key: firstKey(t, (rule) => rule.lotKey) });
    } else if (t.delta < 0) {
      let toConsume = -t.delta;
      if (t.reason === EXPIRY_REASON) {
        const expiredAtThatTime = lots.filter((l) => l.expiresAt != null && l.expiresAt.getTime() <= t.createdAt.getTime());
        toConsume = consumeFifo(expiredAtThatTime, toConsume);
      } else {
        const reversed = firstKey(t, (rule) => rule.reversedLotKey);
        if (reversed) toConsume = consumeFifo(lots.filter((l) => l.key === reversed), toConsume);
      }
      // Nếu còn dư (toConsume>0): lô đã cạn — bất biến vỡ, bỏ qua (không tạo remaining âm).
      consumeFifo(lots, toConsume);
    }
  }
  return lots;
}

/**
 * Điểm còn lại của lô mang khoá `key` (orderLotKey, reviewLotKey) sau khi replay toàn bộ sổ: đã trừ phần cron hết hạn,
 * phần tiêu và các dòng thu hồi đã ghi. null nếu sổ không có lô nào mang khoá đó (dòng cộng cũ thiếu refType/refId):
 * caller không có căn cứ để thu hẹp số điểm thu hồi.
 */
export function lotRemaining(txns: PointExpiryTxn[], key: string): number | null {
  const matching = replayLots(txns).filter((l) => l.key === key);
  return matching.length === 0 ? null : matching.reduce((sum, l) => sum + l.remaining, 0);
}

/**
 * Tính điểm hết hạn theo FIFO (lô cũ tiêu trước) — HÀM THUẦN, không đụng DB, tất định.
 *
 * Bất biến: pointsBalance == SUM(delta) lô STANDARD; caller chỉ đưa vào dòng lô STANDARD (PD-3). Mỗi delta DƯƠNG là một "lô" điểm (có/không expiresAt),
 * mỗi delta ÂM (tiêu/đổi/hoàn) tiêu dần từ lô CŨ NHẤT; riêng POINTS_EXPIRED kỳ trước tiêu lô đã hết hạn trước,
 * và dòng âm đảo ngược một khoản cộng cụ thể (huỷ/trả đơn, xoá đánh giá, thu hồi thưởng giới thiệu) tiêu lô của đúng
 * khoản cộng đó trước, phần dư mới FIFO (xem ReversalRule).
 *
 * Idempotent: dòng POINTS_EXPIRED âm do cron tạo, ở lần chạy sau được replay tiêu đúng các lô đã
 * hết hạn tại thời điểm nó được ghi (xem EXPIRY_REASON) → expiredNow về 0 → chạy lại KHÔNG trừ đôi.
 * Replay FIFO thuần không đủ: lô hết hạn chỉ là lô CŨ NHẤT khi mọi lô cùng thời hạn; lô không hạn
 * (thưởng game, review, giới thiệu) hay lô có hạn dài hơn nằm trước nó thì dòng POINTS_EXPIRED bị
 * replay vào các lô đó, lô hết hạn trông còn nguyên và đêm sau cron trừ lần nữa.
 *
 * KHÔNG bao giờ "đòi lại" điểm đã tiêu: điểm đã bị delta âm tiêu thì lô giảm remaining, phần
 * đã tiêu không còn nằm trong lô hết hạn.
 *
 * @param reminderWindowMs độ dài cửa sổ "sắp hết hạn" tính từ now (ms).
 */
export function computePointExpiry(
  txns: PointExpiryTxn[],
  now: Date,
  reminderWindowMs: number,
): PointExpiryResult {
  const lots = replayLots(txns);

  const nowMs = now.getTime();
  const windowEnd = nowMs + reminderWindowMs;
  let expiredNow = 0;
  let soonAmount = 0;
  let earliest: Date | null = null;
  for (const lot of lots) {
    if (lot.remaining <= 0 || lot.expiresAt == null) continue; // null = không bao giờ hết hạn
    const expMs = lot.expiresAt.getTime();
    if (expMs <= nowMs) {
      expiredNow += lot.remaining;
    } else if (expMs <= windowEnd) {
      soonAmount += lot.remaining;
      if (earliest == null || expMs < earliest.getTime()) earliest = lot.expiresAt;
    }
  }

  return { expiredNow, expiringSoon: { amount: soonAmount, earliestExpiresAt: earliest } };
}

/**
 * Sổ lô STANDARD của một user để đưa vào computePointExpiry / lotRemaining. Chỉ lô STANDARD (PD-3): dòng lô CONVERTED
 * (quy từ xu, không hạn) mà lọt vào FIFO thì dòng tiêu điểm thường ăn nhầm lô quy đổi cũ hơn, lô thường đã tiêu trông
 * "còn nguyên" và cron trừ quá tay; ngược lại dòng tiêu lô quy đổi ăn lô thường cũ và cron trừ thiếu.
 */
export function loadPointExpiryTxns(
  db: Pick<Prisma.TransactionClient, 'pointsTransaction'>,
  userId: string,
): Promise<PointExpiryTxn[]> {
  return db.pointsTransaction.findMany({
    where: { userId, lot: 'STANDARD' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, delta: true, expiresAt: true, createdAt: true, reason: true, refType: true, refId: true },
  });
}

/**
 * Trừ điểm Xanh hết hạn theo FIFO + nhắc điểm sắp hết hạn (bổ sung vào loyalty §6.6).
 * KHÔNG thay đổi cách cộng/tiêu điểm ở nơi khác — chỉ THÊM 2 cron.
 */
@Injectable()
export class LoyaltyExpiryService {
  private readonly logger = new Logger(LoyaltyExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  private loadTxns(
    userId: string,
    db: Pick<Prisma.TransactionClient, 'pointsTransaction'> = this.prisma,
  ): Promise<PointExpiryTxn[]> {
    return loadPointExpiryTxns(db, userId);
  }

  /**
   * Cron 1h sáng: trừ điểm đã hết hạn. Ứng viên = user có ÍT NHẤT 1 lô (delta>0) đã tới hạn;
   * với mỗi user tính lại FIFO từ TOÀN BỘ sổ cái → chỉ trừ phần còn tồn trong lô hết hạn.
   *
   * Phân trang bằng keyset (`userId > cursor` + `orderBy: userId asc`) thay vì lấy đúng BATCH
   * candidate đầu tiên mỗi lần. Trước đây `distinct(userId)` + `take: BATCH` KHÔNG orderBy/cursor:
   * Postgres không đảm bảo cùng 500 user cũ ở đầu kết quả lặp lại y hệt mỗi đêm, nhưng trong thực
   * tế thường trả theo thứ tự vật lý gần cố định — khi số candidate vượt 500, một nhóm user "chiếm
   * chỗ" vĩnh viễn ở top-500 (giống lỗi welcomeVouchers) và điểm hết hạn của user mới hơn có thể
   * không bao giờ được trừ. Không dùng cursor built-in của Prisma (`cursor: { userId }`) vì userId
   * không phải @unique trên PointsTransaction — dùng where `userId: { gt: cursor }` thay thế, cùng
   * tinh thần với LoyaltyService.recalcAllTiers().
   *
   * Toàn thân bọc try/catch: @Cron không tự bắt lỗi — findMany lỗi giữa lúc phân trang ném ra
   * ngoài là unhandledRejection, Node 20 mặc định crash cả process. Lỗi xử lý từng user đã được
   * expireUser().catch() cô lập.
   */
  @Cron('0 1 * * *', { timeZone: CRON_TZ })
  async expirePoints(): Promise<void> {
    try {
      const now = new Date();
      let totalExpired = 0;
      let affected = 0;
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const candidates = await this.prisma.pointsTransaction.findMany({
          where: {
            lot: 'STANDARD',
            delta: { gt: 0 },
            expiresAt: { lte: now },
            ...(cursor ? { userId: { gt: cursor } } : {}),
          },
          select: { userId: true },
          distinct: ['userId'],
          orderBy: { userId: 'asc' },
          take: BATCH,
        });
        if (candidates.length === 0) break;
        cursor = candidates[candidates.length - 1]!.userId;
        for (const c of candidates) {
          const expired = await this.expireUser(c.userId, now).catch((e) => {
            this.logger.warn(`expirePoints lỗi user=${c.userId}: ${(e as Error).message}`);
            return 0;
          });
          if (expired > 0) {
            totalExpired += expired;
            affected++;
          }
        }
        if (candidates.length < BATCH) break;
      }
      if (affected) this.logger.log(`Điểm hết hạn: trừ ${totalExpired} điểm của ${affected} user.`);
    } catch (err) {
      this.logger.error(`expirePoints lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Trừ điểm hết hạn cho 1 user (cặp atomic: decrement có guard + tạo txn âm). Trả về số điểm đã trừ.
   *
   * Tính expiredNow lần đầu KHÔNG khoá để bỏ nhanh phần lớn ứng viên (lô hết hạn đã xử lý ở các đêm trước
   * vẫn là ứng viên mãi mãi). Khi thật sự phải trừ thì khoá dòng user rồi tính lại trong transaction: hai
   * lượt chạy đồng thời (nhiều instance, chạy tay lúc cron) cùng thấy expiredNow trước khi bên kia commit
   * sẽ cùng trừ, guard gte chỉ chặn số dư âm chứ không chặn trừ đôi, và khách mất điểm chưa hết hạn.
   */
  private async expireUser(userId: string, now: Date): Promise<number> {
    const { expiredNow: preview } = computePointExpiry(await this.loadTxns(userId), now, 0);
    if (preview <= 0) return 0;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
      const { expiredNow } = computePointExpiry(await this.loadTxns(userId, tx), now, 0);
      if (expiredNow <= 0) return { expiredNow: 0, applied: true };

      // Guard gte: chỉ trừ khi số dư đủ → pointsBalance KHÔNG bao giờ âm. Nếu count=0
      // (bất biến vỡ: balance < expiredNow) → KHÔNG tạo txn âm, giữ ledger nhất quán.
      const res = await tx.user.updateMany({
        where: { id: userId, pointsBalance: { gte: expiredNow } },
        data: { pointsBalance: { decrement: expiredNow } },
      });
      if (res.count === 0) return { expiredNow, applied: false };
      // Không đặt createdAt tay: xem EXPIRY_REASON.
      await tx.pointsTransaction.create({
        data: { userId, delta: -expiredNow, reason: EXPIRY_REASON, refType: 'EXPIRE', lot: 'STANDARD' },
      });
      return { expiredNow, applied: true };
    });

    if (!result.applied) {
      this.logger.warn(
        `expirePoints bỏ qua user=${userId}: số dư < expiredNow=${result.expiredNow} (guard gte)`,
      );
      return 0;
    }
    return result.expiredNow;
  }

  /**
   * Cron 8h sáng: nhắc user có điểm sắp hết hạn trong cửa sổ (config point_expiry_reminder_days).
   * Dedup qua NotificationLog: bỏ qua nếu đã gửi POINTS_EXPIRING trong ≤ reminderDays ngày.
   *
   * Cùng lỗi thiếu orderBy/cursor như expirePoints() (candidate cũ chiếm chỗ vĩnh viễn khi vượt
   * BATCH) — phân trang bằng keyset y hệt cho nhất quán trong cùng file.
   *
   * Toàn thân bọc try/catch: @Cron không tự bắt lỗi — findMany lỗi giữa lúc phân trang ném ra
   * ngoài là unhandledRejection, Node 20 mặc định crash cả process. Lỗi nhắc từng user đã được
   * remindUser().catch() cô lập.
   */
  @Cron('0 8 * * *', { timeZone: CRON_TZ })
  async remindExpiringPoints(): Promise<void> {
    try {
      const reminderDays = await this.config.get<number>('loyalty.point_expiry_reminder_days', 7);
      const now = new Date();
      const windowMs = reminderDays * DAY;
      const windowEnd = new Date(now.getTime() + windowMs);

      let sent = 0;
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const candidates = await this.prisma.pointsTransaction.findMany({
          where: {
            lot: 'STANDARD',
            delta: { gt: 0 },
            expiresAt: { gt: now, lte: windowEnd },
            ...(cursor ? { userId: { gt: cursor } } : {}),
          },
          select: { userId: true },
          distinct: ['userId'],
          orderBy: { userId: 'asc' },
          take: BATCH,
        });
        if (candidates.length === 0) break;
        cursor = candidates[candidates.length - 1]!.userId;
        for (const c of candidates) {
          const ok = await this.remindUser(c.userId, now, windowMs, reminderDays).catch((e) => {
            this.logger.warn(`remindExpiringPoints lỗi user=${c.userId}: ${(e as Error).message}`);
            return false;
          });
          if (ok) sent++;
        }
        if (candidates.length < BATCH) break;
      }
      if (sent) this.logger.log(`Nhắc điểm sắp hết hạn: ${sent} user.`);
    } catch (err) {
      this.logger.error(`remindExpiringPoints lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async remindUser(
    userId: string,
    now: Date,
    windowMs: number,
    reminderDays: number,
  ): Promise<boolean> {
    const txns = await this.loadTxns(userId);
    const { expiringSoon } = computePointExpiry(txns, now, windowMs);
    if (expiringSoon.amount <= 0 || !expiringSoon.earliestExpiresAt) return false;

    // Dedup: đã nhắc trong kỳ (POINTS_EXPIRING trong ≤ reminderDays) → bỏ qua (chống spam).
    const since = new Date(now.getTime() - reminderDays * DAY);
    const recent = await this.prisma.notificationLog.findFirst({
      where: { userId, templateCode: 'POINTS_EXPIRING', sentAt: { gte: since } },
      select: { id: true },
    });
    if (recent) return false;

    await this.notifications
      .notify(userId, 'POINTS_EXPIRING', {
        points: String(expiringSoon.amount),
        date: formatVnDate(expiringSoon.earliestExpiresAt),
      })
      .catch(() => undefined); // gửi lỗi không chặn lô (notify tự nuốt lỗi ZNS)
    return true;
  }
}
