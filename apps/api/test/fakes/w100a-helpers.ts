/* eslint-disable @typescript-eslint/no-explicit-any -- client giả tạo model theo tên bảng lúc chạy nên kiểu dòng/where là động */
import { RaceDb, type RawContext, type TableSpec } from './race-db.fake';
import { pgLikeClient } from './race-db-client';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { LoyaltyExpiryService } from '../../src/modules/loyalty/loyalty-expiry.service';
import { WasteAdminGiftsService } from '../../src/modules/waste-exchange/catalog/waste-admin-gifts.service';

/**
 * Dựng RaceDb cho test đua của luồng đổi Điểm Xanh lấy quà (LoyaltyService.redeemReward) trên dịch vụ THẬT: bảng và ràng buộc unique khớp schema,
 * các câu SQL thô mà dịch vụ dùng, và các dịch vụ chạm vào cùng dòng users/waste_gifts để cho chúng đua với nhau:
 * LoyaltyService (đổi quà, cộng điểm đơn giao, đảo điểm đơn trả), LoyaltyExpiryService.expireUser (cron hết hạn, hàm private gọi qua ép kiểu)
 * và WasteAdminGiftsService.update (admin sửa quà). Chỉ `recalcTier` bị bỏ (không liên quan tới số dư).
 *
 * Mỗi handler là phần tương đương trong Postgres của ĐÚNG câu SQL thô mà mã thật chạy; điều kiện nằm trong SQL (FOR UPDATE, `"stock" >= 1`,
 * `"status" = 'ACTIVE'`, các vế của WHERE khoá điểm) thì handler chỉ áp khi chính chuỗi SQL còn chứa nó, nên sửa mã thật bỏ điều kiện thì DB giả bỏ theo.
 * Không mô phỏng: khoá chia sẻ (FOR SHARE của đơn khi cộng điểm), KEY SHARE của khoá ngoại, deadlock 40P01, pool kết nối, timeout.
 *
 * Công tắc: `userLock: false` bỏ khoá `SELECT ... FROM "users" ... FOR UPDATE` (UPDATE vẫn giữ khoá dòng và xét lại WHERE như Postgres) để chứng minh
 * từng tầng bảo vệ chứ không để khoá dòng user gánh thay unique (userId, idempotencyKey) và guard số dư.
 */
export interface RedeemWorldOptions {
  userLock?: boolean;
  /** Ghi đè SystemConfig theo khoá (mặc định mọi khoá trả giá trị fallback của mã thật). */
  config?: Record<string, unknown>;
}

const DAY_MS = 86_400_000;
const CLOCK_BASE = Date.now() + 3_600_000;
const reasonStarts = (prefix: string) => (r: Record<string, any>) => typeof r.reason === 'string' && r.reason.startsWith(prefix);

function tables(): Record<string, TableSpec> {
  return {
    user: {},
    order: {},
    returnRequest: {},
    membershipTier: {},
    pointsTransaction: {
      defaults: { lot: 'STANDARD' },
      // Partial unique của sổ: một đơn chỉ cộng một lần, đảo một lần, hoàn điểm đã dùng một lần.
      unique: [
        { fields: ['reason', 'refId'], when: reasonStarts('ORDER_DELIVERED:') },
        { fields: ['reason', 'refId'], when: reasonStarts('ORDER_REVERSED:') },
        { fields: ['reason', 'refId'], when: reasonStarts('ORDER_REFUND_POINTS:') },
      ],
    },
    wasteGift: {},
    wasteGiftRedemption: { unique: [{ fields: ['code'] }, { fields: ['userId', 'idempotencyKey'] }], defaults: { createdAt: new Date(CLOCK_BASE) } },
    coupon: { unique: [{ fields: ['code'] }] },
    wastePoint: {},
    wasteEvent: { defaults: { createdAt: new Date(CLOCK_BASE) } },
  };
}

function installHandlers(db: RaceDb, userLock: boolean): void {
  const lockUserIf = (c: RawContext, id: string) => (c.locking && userLock ? c.lockRow('user', id) : Promise.resolve());

  db.handlers.push(
    {
      // Khoá dòng khách đầu mỗi transaction đổi quà / hết hạn / đảo điểm (cả bản chọn `id` lẫn bản chọn `pointsBalance`).
      match: /FROM "users" WHERE "id" = \?/,
      run: async (c) => {
        const id = c.params[0] as string;
        await lockUserIf(c, id);
        const u = c.rows('user').find((r) => r.id === id);
        return u ? [{ id: u.id, pointsBalance: u.pointsBalance }] : [];
      },
    },
    {
      // creditOrderPoints: FOR SHARE (không khoá trong DB giả: chỉ FOR (NO KEY) UPDATE mới khoá).
      match: /FROM "orders" WHERE "id" = \?/,
      run: (c) => {
        const o = c.rows('order').find((r) => r.id === c.params[0]);
        return o ? [{ status: o.status, userId: o.userId, code: o.code, pointsEarned: o.pointsEarned }] : [];
      },
    },
    {
      // WasteAdminGiftsService.update: đọc bản mới nhất của quà sau khi giành khoá dòng.
      match: /FROM "waste_gifts" WHERE "id" = \?/,
      run: async (c) => {
        const id = c.params[0] as string;
        if (c.locking) await c.lockRow('wasteGift', id);
        const g = c.rows('wasteGift').find((r) => r.id === id);
        return g ? [g] : [];
      },
    },
    {
      // Trừ tồn kho khi đổi quà. UPDATE luôn giành khoá dòng quà rồi xét lại điều kiện trên bản mới nhất.
      match: /UPDATE "waste_gifts" SET "stock" = CASE/,
      run: async (c) => {
        const id = c.params[0] as string;
        await c.lockRow('wasteGift', id);
        const g = c.rows('wasteGift').find((r) => r.id === id);
        if (!g) return 0;
        if (/"status" = 'ACTIVE'/.test(c.sql) && g.status !== 'ACTIVE') return 0;
        if (/"stock" >= 1/.test(c.sql) && g.stock !== null && g.stock < 1) return 0;
        // Số trừ đọc từ chính câu SQL (`ELSE "stock" - n END`): đổi n trong mã thật thì DB giả trừ theo.
        const by = Number(/ELSE "stock" - (\d+) END/.exec(c.sql)?.[1] ?? 0);
        await c.client.wasteGift.update({ where: { id }, data: { stock: g.stock === null ? null : { decrement: by } } });
        return 1;
      },
    },
    {
      // lockedOrderPoints: điểm ORDER_DELIVERED còn có thể bị đảo. Dựng lại đúng câu SQL từ các dòng mà transaction thấy.
      match: /FROM "points_transactions" pt\s+JOIN "orders" o/,
      run: (c) => {
        const [userId, cutoff] = c.params as [string, Date];
        const sqlHas = (re: RegExp) => re.test(c.sql);
        const orders = new Map(c.rows('order').map((o) => [o.id as string, o]));
        const returns = c.rows('returnRequest');
        const ledger = c.rows('pointsTransaction');
        const out: { delta: number; deliveredAt: Date; pendingReturn: boolean }[] = [];
        for (const pt of ledger) {
          if (pt.userId !== userId || !reasonStarts('ORDER_DELIVERED:')(pt) || !(pt.delta > 0)) continue;
          const o = orders.get(pt.refId);
          if (!o) continue;
          if (
            sqlHas(/r\."reason" LIKE 'ORDER_REVERSED:%'/) &&
            ledger.some((r) => r.userId === pt.userId && r.refId === pt.refId && reasonStarts('ORDER_REVERSED:')(r))
          ) {
            continue;
          }
          const mine = returns.filter((r) => r.orderId === o.id);
          const requested = mine.some((r) => r.status === 'REQUESTED');
          const deliveredAt: Date = o.deliveredAt ?? pt.createdAt;
          const inWindow = deliveredAt.getTime() > cutoff.getTime();
          const notDelivered = o.status !== 'DELIVERED';
          const clauses: boolean[] = [];
          if (sqlHas(/COALESCE\(o\."deliveredAt", pt\."createdAt"\) > \?/)) clauses.push(inWindow);
          if (sqlHas(/OR o\."status" <> 'DELIVERED'\s+OR EXISTS/)) clauses.push(notDelivered);
          if (sqlHas(/EXISTS \(SELECT 1 FROM "return_requests" rr WHERE rr\."orderId" = o\."id" AND rr\."status" = 'REQUESTED'\)\s*\)/)) clauses.push(requested);
          if (clauses.length > 0 && !clauses.some(Boolean)) continue;
          const partial = mine.filter((r) => r.status === 'APPROVED' && r.fullReturn === false).reduce((s, r) => s + (r.pointsReversed ?? 0), 0);
          out.push({ delta: Math.max(pt.delta - partial, 0), deliveredAt, pendingReturn: notDelivered || requested });
        }
        return out;
      },
    },
  );
}

/** `createdAt` của dòng sổ điểm do mã thật tạo = đồng hồ logic tăng dần (thứ tự ghi), và `groupBy` mà WasteAdminGiftsService.toDtos cần. */
function adapt(client: any, clock: () => Date): any {
  const out: any = { ...client };
  const ledger = client.pointsTransaction;
  out.pointsTransaction = { ...ledger, create: (args: any) => ledger.create({ ...args, data: { ...args.data, createdAt: args.data.createdAt ?? clock() } }) };
  const redemptions = client.wasteGiftRedemption;
  out.wasteGiftRedemption = {
    ...redemptions,
    groupBy: async (args: { by: string[]; where?: Record<string, unknown> }) => {
      const rows: Record<string, any>[] = await redemptions.findMany({ where: args.where });
      const byKey = new Map<string, { row: Record<string, any>; n: number }>();
      for (const r of rows) {
        const key = args.by.map((f) => String(r[f])).join('|');
        const hit = byKey.get(key);
        if (hit) hit.n += 1;
        else byKey.set(key, { row: r, n: 1 });
      }
      return [...byKey.values()].map(({ row, n }) => ({ ...Object.fromEntries(args.by.map((f) => [f, row[f]])), _count: { _all: n } }));
    },
  };
  if (client.$transaction) {
    out.$transaction = (arg: any) => (typeof arg === 'function' ? client.$transaction((tx: any) => arg(adapt(tx, clock))) : client.$transaction(arg));
  }
  return out;
}

export interface RedeemWorld {
  db: RaceDb;
  loyalty: LoyaltyService;
  admin: WasteAdminGiftsService;
  /** Chạy đúng phần trừ điểm hết hạn của một khách (LoyaltyExpiryService.expireUser, hàm private của cron hằng đêm). */
  expire(userId: string, now?: Date): Promise<number>;
}

export function createRedeemWorld(opts: RedeemWorldOptions = {}): RedeemWorld {
  const db = new RaceDb(tables());
  installHandlers(db, opts.userLock ?? true);
  let seq = 0;
  const prisma = adapt(pgLikeClient(db), () => new Date(CLOCK_BASE + ++seq));
  const config = { get: async (key: string, fallback: unknown) => (opts.config && key in opts.config ? opts.config[key] : fallback) };

  const loyalty = new LoyaltyService(prisma as never, config as never);
  (loyalty as unknown as { recalcTier: () => Promise<void> }).recalcTier = async () => undefined;
  const expiry = new LoyaltyExpiryService(prisma as never, config as never, {} as never);
  const admin = new WasteAdminGiftsService(prisma as never, config as never);
  return {
    db,
    loyalty,
    admin,
    expire: (userId, now = new Date()) => (expiry as unknown as { expireUser(u: string, n: Date): Promise<number> }).expireUser(userId, now),
  };
}

export const userRow = (id: string, pointsBalance: number, over: Record<string, unknown> = {}) => ({
  id,
  role: 'CUSTOMER',
  phone: `09${id.replace(/\D/g, '').padStart(8, '0')}`,
  zaloId: null,
  isBlocked: false,
  mergedIntoId: null,
  pointsBalance,
  pointsConvertedBalance: 0,
  tierId: null,
  ...over,
});

export const giftRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'GIFT',
  name: `Quà ${id}`,
  description: null,
  label: null,
  pointsCost: 100,
  status: 'ACTIVE',
  sortOrder: 0,
  imageUrl: null,
  stock: null,
  claimInstructions: null,
  voucherType: null,
  voucherValue: null,
  voucherMinOrder: null,
  voucherMaxDiscount: null,
  voucherValidDays: null,
  createdAt: new Date(CLOCK_BASE),
  updatedAt: new Date(CLOCK_BASE),
  ...over,
});

export const voucherGiftRow = (id: string, over: Record<string, unknown> = {}) =>
  giftRow(id, { kind: 'VOUCHER', voucherType: 'AMOUNT', voucherValue: 50_000, voucherMinOrder: 300_000, voucherValidDays: 30, ...over });

export const warehouseRow = {
  id: 'wh',
  kind: 'WAREHOUSE',
  name: 'Kho Tubu',
  status: 'ACTIVE',
  addressLine: '99 Nguyễn Văn Linh',
  communeName: 'Phường Tân Phong',
  provinceName: 'TP.HCM',
  openingHours: {},
};

/** Lô điểm thường đã có trong sổ (khớp số dư): `ageDays` ngày trước, hạn `expiresInDays` ngày nữa (âm = đã quá hạn, chưa bị cron trừ). */
export const lotRow = (id: string, userId: string, delta: number, ageDays: number, expiresInDays: number | null, over: Record<string, unknown> = {}) => ({
  id,
  userId,
  delta,
  lot: 'STANDARD',
  reason: 'DAILY_CHECKIN:DAY_1',
  refType: 'CHECKIN',
  refId: id,
  createdAt: new Date(Date.now() - ageDays * DAY_MS),
  expiresAt: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * DAY_MS),
  ...over,
});

/** Đơn giao `deliveredDaysAgo` ngày trước kèm dòng điểm ORDER_DELIVERED đã cộng (khớp số dư) cho `earned` điểm. */
export function deliveredOrder(id: string, userId: string, earned: number, status = 'DELIVERED', deliveredDaysAgo = 1) {
  const deliveredAt = new Date(Date.now() - deliveredDaysAgo * DAY_MS);
  return {
    order: { id, code: `TT-${id}`, userId, status, pointsEarned: earned, pointsUsed: 0, pointsUsedConverted: 0, deliveredAt },
    ledger: lotRow(`pt-${id}`, userId, earned, deliveredDaysAgo, 365, { reason: `ORDER_DELIVERED:TT-${id}`, refType: 'ORDER', refId: id, createdAt: deliveredAt }),
  };
}
