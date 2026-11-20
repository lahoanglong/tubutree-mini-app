import type { Prisma, PrismaClient } from '@prisma/client';
import { isRealUser } from '../../common/real-user';
import {
  fullyReturnedOrderIds,
  hasReferralEntry,
  isAnonymized,
  lockReferee,
  lockReferrer,
  resolveMergedUserId,
} from '../wallet/referral-reward';
import { firstOrderBlockReason, vnMonthStart, type FirstOrderBlockReason } from './first-order-guard';
import { readViralRules, type ConfigReader, type ViralRules } from './viral-config';

/**
 * Thưởng ĐƠN ĐẦU của chương trình giới thiệu (cờ growth.referral_viral_enabled, mặc định TẮT). Nối tiếp chương trình duy nhất ở
 * wallet/referral-reward.ts (users.referredById, refType REFERRAL, partial unique index theo reason), không thay thưởng đơn thứ 2.
 *
 * Bạn được mời (người dùng thật) có đơn lẻ giao thành công ĐẦU TIÊN đạt growth.referral_first_order_min (mặc định 199.000đ, không
 * tính đơn đã trả hết phần có tiền) thì cả người mời lẫn người được mời nhận growth.referral_first_order_points Điểm Xanh lô
 * STANDARD (có hạn, nằm dưới trần dùng điểm loyalty.max_redeem_pct như mọi điểm thưởng). Người mời là CTV, chủ gian hàng mẫu,
 * tài khoản bị khoá, đã xoá hoặc chưa là người dùng thật thì không ai nhận; bạn được mời bị khoá tài khoản cũng vậy.
 *
 * Idempotent: reason theo NGƯỜI ĐƯỢC MỜI (REFERRAL_FIRST_ORDER_REFERRER:<id> ở sổ người mời, REFERRAL_FIRST_ORDER_REFEREE:<id> ở sổ
 * người được mời), refId = id đơn. Một người được mời chỉ thưởng một lần dù đơn lật trạng thái lại, cron chạy lại việc sau giao hay
 * đơn khác của họ giao sau. Đơn đã dùng để thưởng (kể cả dưới id phiên khách trước khi gộp) không dùng lại.
 *
 * Không thu hồi khi đơn bị trả sau lúc thưởng: mỗi bên 100 điểm = 100đ, có trần tháng; chỉ cần đơn còn DELIVERED và chưa trả hết
 * lúc xét.
 */
export const FIRST_ORDER_REFERRER_PREFIX = 'REFERRAL_FIRST_ORDER_REFERRER:';
export const FIRST_ORDER_REFEREE_PREFIX = 'REFERRAL_FIRST_ORDER_REFEREE:';

/** Số đơn gần nhất của người mời đem so địa chỉ giao và IP. */
const REFERRER_ORDER_SAMPLE = 50;

export type FirstOrderSkip = 'OFF' | 'NOT_ELIGIBLE' | 'NO_REFERRER' | 'REFERRER_INELIGIBLE' | 'REFEREE_INELIGIBLE' | 'GUEST' | 'ALREADY' | 'NOT_FIRST' | 'CAPPED';

export type FirstOrderOutcome =
  | { status: 'GRANTED'; referrerId: string; refereeId: string; points: number }
  | { status: 'BLOCKED'; reason: FirstOrderBlockReason }
  | { status: 'SKIPPED'; reason: FirstOrderSkip };

/**
 * Hai lần xét liền nhau đều gặp tài khoản người được mời (hay người mời) đổi giữa lúc đọc và lúc khoá dòng: có lần gộp tài khoản đang chạy
 * chen. Ném để việc sau giao của đơn chưa có mốc và DeliveredEffectsResyncCron xét lại sau khi gộp xong, thay vì bỏ hẳn thưởng của cặp.
 */
export class FirstOrderRetryableError extends Error {
  constructor(orderId: string) {
    super(`Thưởng đơn đầu cho đơn ${orderId}: tài khoản đang được gộp, xét lại ở lượt sau`);
    this.name = 'FirstOrderRetryableError';
  }
}

/** Lần xét gặp tài khoản đổi giữa chừng (gộp chạy chen): đọc lại từ đầu. */
const STALE = Symbol('STALE');

export interface FirstOrderDeps {
  prisma: Pick<PrismaClient, '$transaction' | 'order' | 'user'>;
  config: ConfigReader;
  /** RewardPointsService.grant: cộng lô STANDARD, idempotent theo reason (refType REFERRAL). */
  grant: (userId: string, points: number, reason: string, refType: string, refId: string, tx: Prisma.TransactionClient, expiresAt: Date) => Promise<boolean>;
  expiresAt: () => Promise<Date>;
  now?: () => Date;
}

type Db = Prisma.TransactionClient;

const sampleOwner = (metadata: unknown): boolean => (metadata as { sampleStorefront?: unknown } | null)?.sampleStorefront === true;

async function zaloIdsOf(db: Db, userId: string, own: string | null): Promise<string[]> {
  const merged = await db.user.findMany({ where: { mergedIntoId: userId }, select: { zaloId: true }, take: 20 });
  return [own, ...merged.map((m) => m.zaloId)].filter((z): z is string => typeof z === 'string' && z !== '');
}

/**
 * Đơn đầu đạt mốc của `refereeId` (createdAt, id) trong các đơn đã giao, kể cả đơn giao rồi bị trả (RETURNED, hoặc còn DELIVERED nhưng đã
 * trả hết phần có tiền). Đơn đầu bị trả vẫn là đơn đầu: cặp bị chặn hay chạm trần ở đơn đó không được xét lại bằng cách trả đơn rồi mua đơn khác.
 */
async function firstQualifyingOrder(db: Db, refereeId: string, minOrder: number): Promise<{ id: string; returned: boolean } | null> {
  const [first] = await db.order.findMany({
    where: { userId: refereeId, status: { in: ['DELIVERED', 'RETURNED'] }, type: 'RETAIL', placedForCustomer: false, total: { gte: minOrder } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, status: true },
    take: 1,
  });
  if (!first) return null;
  const returned = first.status === 'RETURNED' || (await fullyReturnedOrderIds(db, [first.id])).has(first.id);
  return { id: first.id, returned };
}

/** Người mời có thể nhận Điểm Xanh giới thiệu: dùng chung cho lúc cấp thưởng và lời hứa trên thẻ thành tích. */
export function canEarnAsReferrer(u: { role: string; isBlocked: boolean; metadata: unknown; phone: string | null; zaloId: string | null }): boolean {
  return u.role !== 'AFFILIATE' && !u.isBlocked && !sampleOwner(u.metadata) && !isAnonymized(u.metadata) && isRealUser(u);
}

/** Số bạn đã thưởng đơn đầu cho `referrerId` trong tháng (giờ Việt Nam) chứa `now`. */
export function referrerFirstOrderCount(db: Pick<Db, 'pointsTransaction'>, referrerId: string, now: Date): Promise<number> {
  return db.pointsTransaction.count({
    where: { userId: referrerId, refType: 'REFERRAL', reason: { startsWith: FIRST_ORDER_REFERRER_PREFIX }, createdAt: { gte: vnMonthStart(now) } },
  });
}

/**
 * Xét thưởng đơn đầu cho một đơn vừa sang DELIVERED (gọi trong việc sau giao, lặp/song song an toàn). Lỗi DB ném lên để việc sau giao
 * của đơn chưa có mốc và cron chạy lại; mọi trường hợp không thưởng trả về `SKIPPED`/`BLOCKED`.
 *
 * Gộp tài khoản chạy chen (auth.service chuyển đơn sang tài khoản đích cùng transaction với mergedIntoId): lần xét đầu thấy dòng đã đổi
 * thì xét lại ngay. Lúc đó lần gộp đã commit (tx chờ khoá dòng tới khi gộp xong) nên lần đọc lại thấy đơn thuộc tài khoản đích và xét theo
 * nó. Lần thứ hai vẫn đổi thì ném FirstOrderRetryableError cho cron xét lại sau.
 */
export async function grantFirstOrderReferralReward(deps: FirstOrderDeps, orderId: string): Promise<FirstOrderOutcome> {
  const rules = await readViralRules(deps.config);
  if (!rules.enabled || rules.points <= 0) return { status: 'SKIPPED', reason: 'OFF' };
  const first = await evaluate(deps, rules, orderId, false);
  if (first !== STALE) return first;
  const second = await evaluate(deps, rules, orderId, true);
  if (second !== STALE) return second;
  throw new FirstOrderRetryableError(orderId);
}

async function evaluate(deps: FirstOrderDeps, rules: ViralRules, orderId: string, reread: boolean): Promise<FirstOrderOutcome | typeof STALE> {
  const order = await deps.prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      type: true,
      status: true,
      total: true,
      placedForCustomer: true,
      createdAt: true,
      shippingAddress: true,
      guestPhone: true,
      guestIpHash: true,
      placedIpHash: true,
    },
  });
  if (!order || order.type !== 'RETAIL' || order.placedForCustomer || order.status !== 'DELIVERED' || order.total < rules.minOrder) {
    return { status: 'SKIPPED', reason: 'NOT_ELIGIBLE' };
  }
  const refereeId = order.userId;
  const referee = await deps.prisma.user.findUnique({
    where: { id: refereeId },
    select: { referredById: true, mergedIntoId: true, phone: true, zaloId: true, metadata: true, isBlocked: true },
  });
  // Đơn đọc trước khi lần gộp commit, dòng người được mời đọc sau: đọc lại thì đơn đã thuộc tài khoản đích. Đọc lại rồi mà đơn vẫn nằm ở
  // dòng đã gộp thì không phải chạy chen.
  if (referee?.mergedIntoId && !reread) return STALE;
  if (!referee || referee.mergedIntoId || isAnonymized(referee.metadata)) return { status: 'SKIPPED', reason: 'NOT_ELIGIBLE' };
  if (!isRealUser(referee)) return { status: 'SKIPPED', reason: 'GUEST' };
  if (referee.isBlocked) return { status: 'SKIPPED', reason: 'REFEREE_INELIGIBLE' };
  const referrerId = referee.referredById ? await resolveMergedUserId(deps.prisma as unknown as Db, referee.referredById) : null;
  if (!referrerId) return { status: 'SKIPPED', reason: 'NO_REFERRER' };
  // Tự mời (referrerId === refereeId) để luật SELF của firstOrderBlockReason chặn trong tx, sau ALREADY/NOT_FIRST: mỗi người chỉ một đơn đầu
  // nên số đếm chặn (một dòng theo đơn) không cộng thêm cho mỗi đơn sau của cùng người.
  const referrer = await deps.prisma.user.findUnique({
    where: { id: referrerId },
    select: { role: true, metadata: true, phone: true, zaloId: true, isBlocked: true },
  });
  if (!referrer || !canEarnAsReferrer(referrer)) return { status: 'SKIPPED', reason: 'REFERRER_INELIGIBLE' };
  // Hạn điểm đọc TRƯỚC khi mở tx: đọc cấu hình trong tx xin kết nối pool thứ hai (RewardPointsService.grant).
  const expiresAt = await deps.expiresAt();
  const now = deps.now?.() ?? new Date();
  const referrerReason = `${FIRST_ORDER_REFERRER_PREFIX}${refereeId}`;
  const refereeReason = `${FIRST_ORDER_REFEREE_PREFIX}${refereeId}`;

  return deps.prisma.$transaction(async (tx): Promise<FirstOrderOutcome | typeof STALE> => {
    // Cùng thứ tự khoá với thưởng đơn thứ 2 và mọi đường thu hồi: người được mời rồi người mời.
    await lockReferee(tx, refereeId);
    const fresh = await tx.user.findUnique({ where: { id: refereeId }, select: { referredById: true, mergedIntoId: true, isBlocked: true } });
    if (fresh?.mergedIntoId) return STALE;
    if ((fresh?.referredById ? await resolveMergedUserId(tx, fresh.referredById) : null) !== referrerId) return STALE;
    if (fresh?.isBlocked) return { status: 'SKIPPED', reason: 'REFEREE_INELIGIBLE' };
    if (await hasReferralEntry(tx, [referrerReason, refereeReason])) return { status: 'SKIPPED', reason: 'ALREADY' };

    const first = await firstQualifyingOrder(tx, refereeId, rules.minOrder);
    if (!first || first.id !== order.id) return { status: 'SKIPPED', reason: 'NOT_FIRST' };
    if (first.returned) return { status: 'SKIPPED', reason: 'NOT_ELIGIBLE' };
    // Một đơn bất kỳ của tài khoản này đã được thưởng đơn đầu dưới id khác (phiên khách đã gộp vào): người này đã nhận rồi.
    const ownOrders = await tx.order.findMany({ where: { userId: refereeId, status: { in: ['DELIVERED', 'RETURNED'] } }, select: { id: true } });
    const usedOrder = await tx.pointsTransaction.findFirst({
      where: {
        refType: 'REFERRAL',
        refId: { in: [order.id, ...ownOrders.map((o) => o.id)] },
        OR: [{ reason: { startsWith: FIRST_ORDER_REFERRER_PREFIX } }, { reason: { startsWith: FIRST_ORDER_REFEREE_PREFIX } }],
      },
      select: { id: true },
    });
    if (usedOrder) return { status: 'SKIPPED', reason: 'ALREADY' };

    const [addresses, referrerOrders, referrerZalo, refereeZalo] = await Promise.all([
      tx.address.findMany({
        where: { userId: referrerId },
        select: { phone: true, street: true, ward: true, wardCode: true, district: true, province: true },
      }),
      tx.order.findMany({
        where: { userId: referrerId },
        orderBy: { createdAt: 'desc' },
        take: REFERRER_ORDER_SAMPLE,
        select: { createdAt: true, shippingAddress: true, placedIpHash: true, guestIpHash: true },
      }),
      zaloIdsOf(tx, referrerId, referrer.zaloId),
      zaloIdsOf(tx, refereeId, referee.zaloId),
    ]);
    const blocked = firstOrderBlockReason({
      referrer: {
        id: referrerId,
        phone: referrer.phone,
        zaloIds: referrerZalo,
        addresses,
        orders: referrerOrders.map((o) => ({ createdAt: o.createdAt, shippingAddress: o.shippingAddress, ipHashes: [o.placedIpHash, o.guestIpHash] })),
      },
      referee: { id: refereeId, phone: referee.phone, zaloIds: refereeZalo, guestPhone: order.guestPhone },
      order: { createdAt: order.createdAt, shippingAddress: order.shippingAddress, ipHashes: [order.placedIpHash, order.guestIpHash] },
    });
    if (blocked) return { status: 'BLOCKED', reason: blocked };

    // Khoá người mời rồi mới đếm trần tháng: hai đơn đầu của hai bạn khác nhau giao cùng lúc không cùng đọc một số đếm cũ.
    await lockReferrer(tx, referrerId);
    if ((await referrerFirstOrderCount(tx, referrerId, now)) >= rules.monthlyCap) return { status: 'SKIPPED', reason: 'CAPPED' };

    const paidReferrer = await deps.grant(referrerId, rules.points, referrerReason, 'REFERRAL', order.id, tx, expiresAt);
    const paidReferee = await deps.grant(refereeId, rules.points, refereeReason, 'REFERRAL', order.id, tx, expiresAt);
    // Hai dòng cùng có hoặc cùng không: chỉ một dòng mới là sổ lệch, ném để rollback cả hai và lần sau xét lại.
    if (paidReferrer !== paidReferee) throw new Error(`Thưởng đơn đầu cho đơn ${order.id}: chỉ một trong hai dòng ghi được`);
    if (!paidReferrer) return { status: 'SKIPPED', reason: 'ALREADY' };
    return { status: 'GRANTED', referrerId, refereeId, points: rules.points };
  });
}
