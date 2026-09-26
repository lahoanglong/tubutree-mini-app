import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LoyaltyService, DEFAULT_REWARD_CATALOG, DEFAULT_CHECKIN_POINTS } from './loyalty.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';


function makeConfig(overrides: Record<string, unknown> = {}): SystemConfigService {
  return {
    get: async <T>(k: string, fb?: T): Promise<T> => (k in overrides ? (overrides[k] as T) : (fb as T)),
  } as unknown as SystemConfigService;
}

/** Ngày theo giờ VN (UTC+7) — đúng quy ước dayKey của service. */
const vnDay = (d: Date) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const DAY = 864e5;

// ─────────────────────────────────────────────────────────────────────────────
// Fake DB in-memory mô phỏng ĐÚNG những bảo đảm Postgres mà code dựa vào:
//  - mỗi thao tác nhường event-loop (await tick) → request song song XEN KẼ như thật;
//  - unique (loyalty_check_ins.userId+dayKey, pos_point_credits.receiptId, coupons.code,
//    partial unique points_transactions CHECKIN/POS) ném P2002;
//  - updateMany với guard `pointsBalance.gte` là 1 câu lệnh atomic;
//  - pg_advisory_xact_lock ($executeRaw trong tx) giữ khoá tới khi transaction kết thúc.
// KHÔNG mô phỏng rollback — code phải tự đặt bước "giành quyền" (insert unique / updateMany
// guard) TRƯỚC mọi bước cộng/trừ tiền-điểm, nên không cần rollback để đúng.
// ─────────────────────────────────────────────────────────────────────────────
const tick = () => new Promise<void>((r) => setImmediate(r));
const p2002 = (target: string) =>
  new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on ${target}`, {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });

class Mutex {
  private tail: Promise<void> = Promise.resolve();
  acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.tail;
    this.tail = prev.then(() => next);
    return prev.then(() => release);
  }
}

type Row = Record<string, any>;

function applyData(target: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'increment' in v) target[k] += v.increment;
    else if (v && typeof v === 'object' && 'decrement' in v) target[k] -= v.decrement;
    else target[k] = v;
  }
}

/**
 * Dòng "điểm còn có thể bị đảo" mà câu SQL lockedOrderPoints trả về (xem LoyaltyService):
 * điểm ORDER_DELIVERED của đơn còn trong cửa sổ đổi/trả / đang có yêu cầu đổi/trả / đã huỷ-trả
 * nhưng chưa trừ điểm. Câu SQL thật được kiểm trên Postgres ở test/integration-race.
 */
type LockedRow = { delta: number; deliveredAt: Date; pendingReturn: boolean };

function makeFakeDb(users: Row[], opts: { advisoryLock?: boolean; lockedRows?: LockedRow[] } = {}) {
  const advisoryLock = opts.advisoryLock ?? true;
  const db = {
    lockedRows: opts.lockedRows ?? ([] as LockedRow[]),
    users: new Map<string, Row>(
      users.map((u) => [
        u.id,
        { pointsBalance: 0, role: 'CUSTOMER', isBlocked: false, tier: null, phone: null, fullName: null, ...u },
      ]),
    ),
    checkIns: [] as Row[],
    ledger: [] as Row[],
    coupons: [] as Row[],
    posCredits: [] as Row[],
    gameProfileTouched: false,
  };
  const lock = new Mutex();
  /** Khoá dòng users (SELECT … FOR UPDATE) — giữ tới hết transaction, như Postgres. */
  const rowLocks = new Map<string, Mutex>();
  let seq = 0;
  const nextId = (p: string) => `${p}-${++seq}`;

  function client(ctx?: { releases: (() => void)[] }) {
    return {
      user: {
        findUnique: async ({ where }: any) => {
          await tick();
          const u = db.users.get(where.id);
          return u ? { ...u } : null;
        },
        findUniqueOrThrow: async ({ where }: any) => {
          await tick();
          const u = db.users.get(where.id);
          if (!u) throw new Error('User not found');
          return { ...u };
        },
        findMany: async ({ where, take }: any) => {
          await tick();
          const conds: Row[] = where?.OR ?? [];
          const out = [...db.users.values()].filter((u) =>
            conds.some(
              (c) =>
                (c.phone !== undefined && typeof c.phone === 'string' && u.phone === c.phone) ||
                (c.referralCode?.in && c.referralCode.in.includes(u.referralCode)),
            ),
          );
          return out.slice(0, take ?? out.length).map((u) => ({ ...u }));
        },
        update: async ({ where, data }: any) => {
          await tick();
          const u = db.users.get(where.id);
          if (!u) throw new Error('User not found');
          applyData(u, data);
          return { ...u };
        },
        updateMany: async ({ where, data }: any) => {
          await tick();
          const u = db.users.get(where.id);
          if (!u) return { count: 0 };
          const gte = where.pointsBalance?.gte;
          if (gte != null && !(u.pointsBalance >= gte)) return { count: 0 };
          applyData(u, data);
          return { count: 1 };
        },
      },
      loyaltyCheckIn: {
        findFirst: async ({ where }: any) => {
          await tick();
          const rows = db.checkIns
            .filter((r) => r.userId === where.userId)
            .sort((a, b) => (a.dayKey < b.dayKey ? 1 : -1));
          return rows[0] ? { ...rows[0] } : null;
        },
        create: async ({ data }: any) => {
          await tick();
          if (db.checkIns.some((r) => r.userId === data.userId && r.dayKey === data.dayKey)) {
            throw p2002('loyalty_check_ins_userId_dayKey_key');
          }
          const row = { id: nextId('ci'), createdAt: new Date(), ...data };
          db.checkIns.push(row);
          return { ...row };
        },
      },
      pointsTransaction: {
        create: async ({ data }: any) => {
          await tick();
          if (
            data.refType === 'CHECKIN' &&
            db.ledger.some((r) => r.refType === 'CHECKIN' && r.userId === data.userId && r.refId === data.refId)
          ) {
            throw p2002('points_transactions_checkin_day_key');
          }
          if (data.refType === 'POS' && db.ledger.some((r) => r.refType === 'POS' && r.refId === data.refId)) {
            throw p2002('points_transactions_pos_ref_key');
          }
          const row = { id: nextId('ptx'), createdAt: new Date(), ...data };
          db.ledger.push(row);
          return { ...row };
        },
      },
      coupon: {
        create: async ({ data }: any) => {
          await tick();
          if (db.coupons.some((c) => c.code === data.code)) throw p2002('coupons_code_key');
          const row = { id: nextId('cp'), ...data };
          db.coupons.push(row);
          return { ...row };
        },
      },
      posPointCredit: {
        findUnique: async ({ where }: any) => {
          await tick();
          const r = db.posCredits.find((x) => x.receiptId === where.receiptId);
          return r ? { ...r } : null;
        },
        aggregate: async ({ where }: any) => {
          await tick();
          const rows = db.posCredits.filter(
            (r) =>
              r.dayKey === where.dayKey &&
              (where.staffUserId === undefined || r.staffUserId === where.staffUserId) &&
              (where.memberId === undefined || r.memberId === where.memberId),
          );
          const sum = rows.reduce((s, r) => s + r.points, 0);
          return { _sum: { points: rows.length ? sum : null } };
        },
        create: async ({ data }: any) => {
          await tick();
          if (db.posCredits.some((r) => r.receiptId === data.receiptId)) throw p2002('pos_point_credits_receiptId_key');
          const row = { id: nextId('pos'), createdAt: new Date(), ...data };
          db.posCredits.push(row);
          return { ...row };
        },
      },
      // Bất kỳ truy cập nào vào gameProfile là LỖI: điểm danh loyalty phải tách hẳn khỏi Vườn Xanh.
      get gameProfile(): never {
        db.gameProfileTouched = true;
        throw new Error('loyalty KHÔNG được đụng game_profiles');
      },
      $executeRaw: async () => {
        if (!ctx) throw new Error('advisory lock gọi ngoài transaction');
        if (!advisoryLock) return 1; // mô phỏng "không có khoá" cho bài tự kiểm harness
        const release = await lock.acquire();
        ctx.releases.push(release);
        return 1;
      },
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        await tick();
        const sql = strings.join('?');
        if (/FOR UPDATE/.test(sql)) {
          if (!ctx) throw new Error('FOR UPDATE gọi ngoài transaction');
          const id = String(values[0]);
          if (!rowLocks.has(id)) rowLocks.set(id, new Mutex());
          ctx.releases.push(await rowLocks.get(id)!.acquire());
          return db.users.has(id) ? [{ id }] : [];
        }
        if (/ORDER_DELIVERED/.test(sql)) return db.lockedRows.map((r) => ({ ...r }));
        throw new Error(`fake $queryRaw không hỗ trợ: ${sql}`);
      },
    };
  }

  // Không spread (sẽ kích hoạt getter gameProfile) — gắn $transaction thẳng lên object.
  const prisma: any = client();
  prisma.$transaction = async (arg: any) => {
    if (typeof arg !== 'function') throw new Error('fake chỉ hỗ trợ interactive transaction');
    const ctx: { releases: (() => void)[] } = { releases: [] };
    try {
      return await arg(client(ctx));
    } finally {
      for (const release of ctx.releases) release();
    }
  };
  return { db, prisma: prisma as PrismaService };
}

// Tự kiểm harness: chứng minh fake DB THẬT SỰ bắt được race — nếu không, các test CONCURRENCY
// bên dưới pass vô nghĩa.
describe('fake DB (tự kiểm)', () => {
  it('bắt được race check-rồi-trừ kiểu bản WIP cũ: 5 request song song đẩy số dư xuống ÂM', async () => {
    const { db, prisma } = makeFakeDb([{ id: 'u1', pointsBalance: 100, referralCode: 'AAAA1111' }]);
    const naive = () =>
      (prisma as any).$transaction(async (tx: any) => {
        const u = await tx.user.findUniqueOrThrow({ where: { id: 'u1' } });
        if (u.pointsBalance < 100) throw new BadRequestException('không đủ');
        await tx.user.update({ where: { id: 'u1' }, data: { pointsBalance: { decrement: 100 } } });
      });
    await Promise.allSettled(Array.from({ length: 5 }, naive));
    expect(db.users.get('u1')!.pointsBalance).toBeLessThan(0);
  });

  it('bỏ advisory lock thì trần ngày POS bị vượt khi gửi song song (khoá là cần thiết)', async () => {
    const { db, prisma } = makeFakeDb(
      [
        { id: 'staff-1', role: 'STAFF', referralCode: 'STAFF001' },
        { id: 'm2', phone: '0912000000', referralCode: 'EE00FF11' },
      ],
      { advisoryLock: false },
    );
    const svc = new LoyaltyService(
      prisma,
      makeConfig({ 'loyalty.pos_credit_enabled': true, 'loyalty.pos_staff_daily_points_cap': 100 }),
    );
    await Promise.allSettled(
      ['HD-A', 'HD-B', 'HD-C'].map((receiptId) =>
        svc.creditPosPoints('staff-1', { memberCode: 'TUBUEE00FF11', orderTotal: 500_000, receiptId }),
      ),
    );
    expect(db.users.get('m2')!.pointsBalance).toBeGreaterThan(100);
  });
});

describe('LoyaltyService — tính năng CNV Loyalty Parity', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  // ───────────────────────────── Reward catalog ─────────────────────────────
  describe('Reward Catalog & Redemption', () => {
    it('getRewardCatalog trả về danh sách phần thưởng kèm cờ canRedeem', async () => {
      const prisma = {
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', pointsBalance: 60 }) },
        $queryRaw: jest.fn().mockResolvedValue([]),
      } as unknown as PrismaService;

      const res = await new LoyaltyService(prisma, makeConfig()).getRewardCatalog('u1');
      expect(res.pointsBalance).toBe(60);
      expect(res.rewards.length).toBe(DEFAULT_REWARD_CATALOG.length);
      for (const r of res.rewards) expect(r.canRedeem).toBe(60 >= r.pointsCost);
    });

    it('getRewardCatalog: canRedeem theo điểm DÙNG ĐƯỢC (số dư − điểm đơn mới giao còn trong hạn đổi/trả)', async () => {
      const prisma = {
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', pointsBalance: 120 }) },
        $queryRaw: jest.fn().mockResolvedValue([
          { delta: 80, deliveredAt: new Date(Date.now() - 2 * DAY), pendingReturn: false },
        ]),
      } as unknown as PrismaService;
      const res = await new LoyaltyService(prisma, makeConfig()).getRewardCatalog('u1');
      expect(res).toMatchObject({ pointsBalance: 120, lockedPoints: 80, redeemablePoints: 40 });
      const byId = new Map(res.rewards.map((r) => [r.id, r.canRedeem]));
      expect(byId.get('reward-freeship')).toBe(true); // 20 ≤ 40
      expect(byId.get('reward-discount-50k')).toBe(false); // 50 > 40 dù số dư 120
    });

    it('voucher freeship mô tả ĐÚNG hành vi checkout (miễn toàn bộ phí ship, không ghi "tối đa 25k")', () => {
      const fs = DEFAULT_REWARD_CATALOG.find((r) => r.type === 'FREESHIP')!;
      expect(fs.title).not.toMatch(/25/);
      expect(fs.description).not.toMatch(/tối đa/i);
      // Dưới ngưỡng freeship mặc định 200k mới có ý nghĩa.
      expect(fs.minOrder!).toBeLessThan(200_000);
    });

    it('redeemReward ném NotFoundException nếu rewardId không tồn tại', async () => {
      const svc = new LoyaltyService({} as unknown as PrismaService, makeConfig());
      await expect(svc.redeemReward('u1', 'invalid-id')).rejects.toThrow(NotFoundException);
    });

    it('không đủ điểm → BadRequest, KHÔNG tạo coupon/ledger, số dư giữ nguyên', async () => {
      const { db, prisma } = makeFakeDb([{ id: 'u1', pointsBalance: 20, referralCode: 'AAAA1111' }]);
      const svc = new LoyaltyService(prisma, makeConfig());
      await expect(svc.redeemReward('u1', 'reward-discount-50k')).rejects.toThrow(BadRequestException);
      expect(db.users.get('u1')!.pointsBalance).toBe(20);
      expect(db.coupons).toHaveLength(0);
      expect(db.ledger).toHaveLength(0);
    });

    it('trừ điểm bằng updateMany có guard gte (atomic) rồi mới tạo coupon cá nhân + ledger REWARD', async () => {
      const { db, prisma } = makeFakeDb([{ id: 'user-abc', pointsBalance: 100, referralCode: 'AAAA1111' }]);
      const svc = new LoyaltyService(prisma, makeConfig());
      const res = await svc.redeemReward('user-abc', 'reward-discount-50k');

      expect(res.success).toBe(true);
      expect(res.pointsSpent).toBe(50);
      expect(res.remainingPoints).toBe(50);
      expect(res.coupon.code).toMatch(/^REWARD-AMO50K-[A-Z0-9]{8}$/);
      expect(res.coupon.value).toBe(50000);
      expect(db.users.get('user-abc')!.pointsBalance).toBe(50);
      expect(db.coupons).toHaveLength(1);
      expect(db.coupons[0]).toMatchObject({ usageLimit: 1, perUserLimit: 1, scope: 'USER_GROUP', scopeMeta: { userId: 'user-abc' } });
      expect(db.ledger).toEqual([
        expect.objectContaining({
          userId: 'user-abc',
          delta: -50,
          reason: 'LOYALTY_REDEEM_VOUCHER:reward-discount-50k',
          refType: 'REWARD',
          refId: db.coupons[0]!.id,
        }),
      ]);
    });

    it('trừ điểm dùng updateMany có guard pointsBalance.gte trong transaction (không check-rồi-trừ)', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const tx = {
        user: { updateMany, findUnique: jest.fn().mockResolvedValue({ pointsBalance: 99 }) },
        coupon: { create: jest.fn() },
        pointsTransaction: { create: jest.fn() },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };
      const prisma = { $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)) } as unknown as PrismaService;
      await expect(new LoyaltyService(prisma, makeConfig()).redeemReward('u1', 'reward-discount-100k')).rejects.toThrow(
        /cần 100 Điểm Xanh.*hiện có 99/,
      );
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'u1', pointsBalance: { gte: 100 } },
        data: { pointsBalance: { decrement: 100 } },
      });
      expect(tx.coupon.create).not.toHaveBeenCalled();
      expect(tx.pointsTransaction.create).not.toHaveBeenCalled();
    });

    it('CONCURRENCY: 5 request đổi song song với 100 điểm / giá 100 → đúng 1 voucher, số dư 0, KHÔNG âm', async () => {
      const { db, prisma } = makeFakeDb([{ id: 'u1', pointsBalance: 100, referralCode: 'AAAA1111' }]);
      const svc = new LoyaltyService(prisma, makeConfig());
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => svc.redeemReward('u1', 'reward-discount-100k')),
      );
      const ok = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(ok).toHaveLength(1);
      expect(rejected).toHaveLength(4);
      for (const r of rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
      expect(db.users.get('u1')!.pointsBalance).toBe(0);
      expect(db.coupons).toHaveLength(1);
      expect(db.ledger.filter((l) => l.delta < 0)).toHaveLength(1);
    });

    // Lạm dụng: nhận điểm đơn vừa giao → đổi ngay voucher → trả hàng (điểm bị trừ lại, có thể âm)
    // nhưng voucher vẫn giữ. Chỉ điểm KHÔNG còn bị đảo được mới đổi quà được.
    describe('điểm từ đơn còn có thể bị trả hàng chưa được đổi quà', () => {
      const vnDate = (d: Date) => {
        const v = new Date(d.getTime() + 7 * 3600 * 1000);
        const p = (n: number) => String(n).padStart(2, '0');
        return `${p(v.getUTCDate())}/${p(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
      };

      it('số dư đủ nhưng phần dùng được KHÔNG đủ → BadRequest nêu rõ số điểm + ngày mở khoá, không trừ gì', async () => {
        const deliveredAt = new Date(Date.now() - 2 * DAY);
        const { db, prisma } = makeFakeDb([{ id: 'u1', pointsBalance: 100, referralCode: 'AAAA1111' }], {
          lockedRows: [{ delta: 60, deliveredAt, pendingReturn: false }],
        });
        const err = await new LoyaltyService(prisma, makeConfig())
          .redeemReward('u1', 'reward-discount-50k')
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(BadRequestException);
        const unlock = vnDate(new Date(deliveredAt.getTime() + 7 * DAY)); // returns.window_days mặc định 7
        expect((err as Error).message).toContain(`60 điểm từ đơn mới giao sẽ dùng được sau ngày ${unlock}`);
        expect((err as Error).message).toContain('40');
        expect(db.users.get('u1')!.pointsBalance).toBe(100);
        expect(db.coupons).toHaveLength(0);
        expect(db.ledger).toHaveLength(0);
      });

      it('cửa sổ đổi/trả đọc từ returns.window_days', async () => {
        const deliveredAt = new Date(Date.now() - DAY);
        const { prisma } = makeFakeDb([{ id: 'u1', pointsBalance: 100, referralCode: 'AAAA1111' }], {
          lockedRows: [{ delta: 60, deliveredAt, pendingReturn: false }],
        });
        const err = await new LoyaltyService(prisma, makeConfig({ 'returns.window_days': 14 }))
          .redeemReward('u1', 'reward-discount-50k')
          .catch((e: unknown) => e);
        expect((err as Error).message).toContain(vnDate(new Date(deliveredAt.getTime() + 14 * DAY)));
      });

      it('đơn đang có yêu cầu đổi/trả chờ duyệt → điểm bị khoá tới khi yêu cầu được xử lý', async () => {
        const { prisma } = makeFakeDb([{ id: 'u1', pointsBalance: 100, referralCode: 'AAAA1111' }], {
          lockedRows: [{ delta: 70, deliveredAt: new Date(Date.now() - 20 * DAY), pendingReturn: true }],
        });
        const err = await new LoyaltyService(prisma, makeConfig())
          .redeemReward('u1', 'reward-discount-50k')
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as Error).message).toMatch(/70 điểm từ đơn đang chờ xử lý đổi\/trả/);
      });

      it('phần điểm dùng được đủ → đổi bình thường (chỉ khoá đúng phần của đơn mới giao)', async () => {
        const { db, prisma } = makeFakeDb([{ id: 'u1', pointsBalance: 150, referralCode: 'AAAA1111' }], {
          lockedRows: [{ delta: 60, deliveredAt: new Date(Date.now() - DAY), pendingReturn: false }],
        });
        const res = await new LoyaltyService(prisma, makeConfig()).redeemReward('u1', 'reward-discount-50k');
        expect(res.success).toBe(true);
        expect(db.users.get('u1')!.pointsBalance).toBe(100);
      });

      it('guard atomic: khoá dòng user (FOR UPDATE) rồi updateMany where pointsBalance ≥ giá + điểm khoá, TRONG tx', async () => {
        const updateMany = jest.fn().mockResolvedValue({ count: 0 });
        const $queryRaw = jest
          .fn()
          .mockResolvedValueOnce([{ id: 'u1' }])
          .mockResolvedValueOnce([{ delta: 60, deliveredAt: new Date(Date.now() - DAY), pendingReturn: false }]);
        const tx = {
          user: { updateMany, findUnique: jest.fn().mockResolvedValue({ pointsBalance: 150 }) },
          coupon: { create: jest.fn() },
          pointsTransaction: { create: jest.fn() },
          $queryRaw,
        };
        const prisma = { $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)) } as unknown as PrismaService;
        await expect(new LoyaltyService(prisma, makeConfig()).redeemReward('u1', 'reward-discount-100k')).rejects.toThrow(
          BadRequestException,
        );
        const firstSql = ($queryRaw.mock.calls[0]![0] as TemplateStringsArray).join('?');
        expect(firstSql).toMatch(/FROM "users"[\s\S]*FOR UPDATE/);
        expect(updateMany).toHaveBeenCalledWith({
          where: { id: 'u1', pointsBalance: { gte: 160 } },
          data: { pointsBalance: { decrement: 100 } },
        });
        expect(tx.coupon.create).not.toHaveBeenCalled();
      });

      it('CONCURRENCY: số dư 150, khoá 60, giá 50 → 5 request song song chỉ 1 voucher, số dư 100', async () => {
        const { db, prisma } = makeFakeDb([{ id: 'u1', pointsBalance: 150, referralCode: 'AAAA1111' }], {
          lockedRows: [{ delta: 60, deliveredAt: new Date(Date.now() - DAY), pendingReturn: false }],
        });
        const svc = new LoyaltyService(prisma, makeConfig());
        const results = await Promise.allSettled(
          Array.from({ length: 5 }, () => svc.redeemReward('u1', 'reward-discount-50k')),
        );
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
        expect(rejected).toHaveLength(4);
        for (const r of rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
        expect(db.users.get('u1')!.pointsBalance).toBe(100); // không đụng 60 điểm đang khoá
        expect(db.coupons).toHaveLength(1);
      });

      it('getOverview trả lockedPoints / redeemablePoints / lockedUntil', async () => {
        const deliveredAt = new Date(Date.now() - 2 * DAY);
        const prisma = {
          user: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', pointsBalance: 100, tierId: null, tier: null }),
          },
          membershipTier: { findMany: jest.fn().mockResolvedValue([]) },
          pointsTransaction: {
            findMany: jest.fn().mockResolvedValue([]),
            aggregate: jest.fn().mockResolvedValue({ _sum: { delta: null } }),
          },
          $queryRaw: jest.fn().mockResolvedValue([
            { delta: 30, deliveredAt, pendingReturn: false },
            { delta: 10, deliveredAt: new Date(Date.now() - 30 * DAY), pendingReturn: true },
          ]),
        } as unknown as PrismaService;
        const ov = await new LoyaltyService(prisma, makeConfig()).getOverview('u1');
        expect(ov).toMatchObject({ pointsBalance: 100, lockedPoints: 40, lockedReturnPoints: 10, redeemablePoints: 60 });
        expect(ov.lockedUntil).toBe(new Date(deliveredAt.getTime() + 7 * DAY).toISOString());
      });

      it('điểm khoá lớn hơn số dư (đã tiêu lúc thanh toán) → redeemablePoints = 0, không âm', async () => {
        const prisma = {
          user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', pointsBalance: 20 }) },
          $queryRaw: jest.fn().mockResolvedValue([{ delta: 90, deliveredAt: new Date(), pendingReturn: false }]),
        } as unknown as PrismaService;
        const res = await new LoyaltyService(prisma, makeConfig()).getRewardCatalog('u1');
        expect(res.redeemablePoints).toBe(0);
        expect(res.rewards.every((r) => !r.canRedeem)).toBe(true);
      });
    });
  });

  // ───────────────────────────── Daily check-in ─────────────────────────────
  describe('Điểm danh hằng ngày (tách riêng khỏi Vườn Xanh)', () => {
    function statusPrisma(last: Row | null) {
      return {
        loyaltyCheckIn: { findFirst: jest.fn().mockResolvedValue(last) },
        get gameProfile(): never {
          throw new Error('loyalty KHÔNG được đụng game_profiles');
        },
      } as unknown as PrismaService;
    }

    it('mặc định điểm danh là bảng BẢO THỦ (≈8 điểm/tuần), không phải 190 điểm/tuần', () => {
      expect(DEFAULT_CHECKIN_POINTS).toHaveLength(7);
      expect(DEFAULT_CHECKIN_POINTS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(10);
    });

    it('status: CHƯA điểm danh, hôm qua là N3 → hôm nay là N4; N1–N3 đã nhận; phần thưởng hiển thị = phần thưởng sẽ nhận', async () => {
      const yesterday = vnDay(new Date(Date.now() - DAY));
      const cfg = makeConfig({ 'loyalty.checkin_points': [1, 2, 3, 4, 5, 6, 7] });
      const status = await new LoyaltyService(
        statusPrisma({ userId: 'u1', dayKey: yesterday, cycleDay: 3, streakDays: 3 }),
        cfg,
      ).getDailyCheckInStatus('u1');

      expect(status.checkedInToday).toBe(false);
      expect(status.streakDays).toBe(3);
      expect(status.currentCycleDay).toBe(4);
      expect(status.todayPoints).toBe(4);
      expect(status.rewards.map((r) => r.claimed)).toEqual([true, true, true, false, false, false, false]);
      expect(status.rewards.findIndex((r) => r.isToday)).toBe(3);
      expect(status.rewards.map((r) => r.points)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('status: hôm qua là N7 → vòng mới, hôm nay là N1, chưa ô nào "đã nhận"', async () => {
      const yesterday = vnDay(new Date(Date.now() - DAY));
      const status = await new LoyaltyService(
        statusPrisma({ userId: 'u1', dayKey: yesterday, cycleDay: 7, streakDays: 14 }),
        makeConfig(),
      ).getDailyCheckInStatus('u1');
      expect(status.currentCycleDay).toBe(1);
      expect(status.streakDays).toBe(14);
      expect(status.rewards.every((r) => !r.claimed)).toBe(true);
      expect(status.rewards[0]!.isToday).toBe(true);
      expect(status.todayPoints).toBe(DEFAULT_CHECKIN_POINTS[0]);
    });

    it('status: chuỗi đứt (lần cuối 3 ngày trước) → streak 0, hôm nay là N1', async () => {
      const old = vnDay(new Date(Date.now() - 3 * DAY));
      const status = await new LoyaltyService(
        statusPrisma({ userId: 'u1', dayKey: old, cycleDay: 5, streakDays: 5 }),
        makeConfig(),
      ).getDailyCheckInStatus('u1');
      expect(status.streakDays).toBe(0);
      expect(status.currentCycleDay).toBe(1);
      expect(status.rewards.every((r) => !r.claimed)).toBe(true);
    });

    it('status: ĐÃ điểm danh hôm nay (N3) → N1–N3 đã nhận, ô hôm nay là N3', async () => {
      const today = vnDay(new Date());
      const status = await new LoyaltyService(
        statusPrisma({ userId: 'u1', dayKey: today, cycleDay: 3, streakDays: 3 }),
        makeConfig(),
      ).getDailyCheckInStatus('u1');
      expect(status.checkedInToday).toBe(true);
      expect(status.currentCycleDay).toBe(3);
      expect(status.rewards.map((r) => r.claimed)).toEqual([true, true, true, false, false, false, false]);
      expect(status.rewards[2]!.isToday).toBe(true);
    });

    it('config loyalty.checkin_points sai kiểu/âm/quá lớn → dùng bảng mặc định', async () => {
      for (const bad of [[1, 2], 'abc', [1, 1, 1, 1, 1, 1, -5], [1, 1, 1, 1, 1, 1, 9999], [1, 1, 1, 1.5, 1, 1, 1]]) {
        const status = await new LoyaltyService(statusPrisma(null), makeConfig({ 'loyalty.checkin_points': bad }))
          .getDailyCheckInStatus('u1');
        expect(status.rewards.map((r) => r.points)).toEqual(DEFAULT_CHECKIN_POINTS);
      }
    });

    it('dailyCheckIn: ghi loyalty_check_ins riêng, ledger CHECKIN có refId=ngày VN + expiresAt, KHÔNG đụng gameProfile', async () => {
      const { db, prisma } = makeFakeDb([{ id: 'u1', pointsBalance: 5, referralCode: 'AAAA1111' }]);
      const yesterday = vnDay(new Date(Date.now() - DAY));
      db.checkIns.push({ id: 'ci-old', userId: 'u1', dayKey: yesterday, cycleDay: 3, streakDays: 10, points: 1 });
      const cfg = makeConfig({ 'loyalty.checkin_points': [1, 2, 3, 4, 5, 6, 7], 'loyalty.point_expire_months': 12 });

      const res = await new LoyaltyService(prisma, cfg).dailyCheckIn('u1');

      expect(res).toMatchObject({ success: true, cycleDay: 4, streakDays: 11, pointsEarned: 4, totalPoints: 9 });
      expect(db.gameProfileTouched).toBe(false);
      const today = vnDay(new Date());
      expect(db.checkIns.find((c) => c.dayKey === today)).toMatchObject({ userId: 'u1', cycleDay: 4, streakDays: 11, points: 4 });
      const row = db.ledger[0]!;
      expect(row).toMatchObject({ userId: 'u1', delta: 4, reason: 'DAILY_CHECKIN:DAY_4', refType: 'CHECKIN', refId: today });
      expect(row.expiresAt).toBeInstanceOf(Date);
      const months = (row.expiresAt.getTime() - Date.now()) / (30 * DAY);
      expect(months).toBeGreaterThan(11);
      expect(months).toBeLessThan(13);
    });

    it('dailyCheckIn: hôm nay đã điểm danh → BadRequest, không cộng thêm', async () => {
      const { db, prisma } = makeFakeDb([{ id: 'u1', pointsBalance: 5, referralCode: 'AAAA1111' }]);
      db.checkIns.push({ id: 'ci-1', userId: 'u1', dayKey: vnDay(new Date()), cycleDay: 1, streakDays: 1, points: 1 });
      await expect(new LoyaltyService(prisma, makeConfig()).dailyCheckIn('u1')).rejects.toThrow(BadRequestException);
      expect(db.users.get('u1')!.pointsBalance).toBe(5);
      expect(db.ledger).toHaveLength(0);
    });

    it('CONCURRENCY: 10 request điểm danh song song → đúng 1 lần cộng điểm, 1 dòng ledger, 9 BadRequest', async () => {
      const { db, prisma } = makeFakeDb([{ id: 'u1', pointsBalance: 0, referralCode: 'AAAA1111' }]);
      const svc = new LoyaltyService(prisma, makeConfig({ 'loyalty.checkin_points': [5, 5, 5, 5, 5, 5, 5] }));
      const results = await Promise.allSettled(Array.from({ length: 10 }, () => svc.dailyCheckIn('u1')));
      const ok = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(ok).toHaveLength(1);
      expect(rejected).toHaveLength(9);
      for (const r of rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
      expect(db.users.get('u1')!.pointsBalance).toBe(5);
      expect(db.ledger).toHaveLength(1);
      expect(db.checkIns).toHaveLength(1);
    });

    it('ranh giới ngày theo giờ VN: 23:00 VN rồi 00:30 VN hôm sau → 2 lần điểm danh hợp lệ, chuỗi nối tiếp', async () => {
      const { db, prisma } = makeFakeDb([{ id: 'u1', pointsBalance: 0, referralCode: 'AAAA1111' }]);
      const svc = new LoyaltyService(prisma, makeConfig({ 'loyalty.checkin_points': [1, 2, 3, 4, 5, 6, 7] }));
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
      jest.setSystemTime(new Date('2026-09-26T16:00:00Z')); // 23:00 ngày 26/09 giờ VN
      await svc.dailyCheckIn('u1');
      jest.setSystemTime(new Date('2026-09-26T17:30:00Z')); // 00:30 ngày 27/09 giờ VN
      const second = await svc.dailyCheckIn('u1');
      expect(db.checkIns.map((c) => c.dayKey)).toEqual(['2026-09-26', '2026-09-27']);
      expect(second).toMatchObject({ cycleDay: 2, streakDays: 2, pointsEarned: 2 });
      expect(db.users.get('u1')!.pointsBalance).toBe(3);
    });
  });

  // ───────────────────────────── Member card ─────────────────────────────
  describe('Thẻ thành viên số', () => {
    it('memberCode = TUBU + referralCode duy nhất; KHÔNG trả mã vạch giả / payload chứa SĐT đầy đủ + userId', async () => {
      const prisma = {
        user: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'u123456',
            phone: '0987654321',
            referralCode: 'AB12CD34',
            fullName: 'Nguyễn Văn A',
            pointsBalance: 150,
            tier: { name: 'Lộc Biếc', pointMultiplier: 1.2 },
          }),
        },
      } as unknown as PrismaService;

      const card = await new LoyaltyService(prisma, makeConfig()).getMemberCard('u123456');
      expect(card.memberCode).toBe('TUBUAB12CD34');
      expect(card.phone).toBe('098****321');
      expect(card.tierName).toBe('Lộc Biếc');
      expect(card.posCreditEnabled).toBe(false);
      expect(card).not.toHaveProperty('barcode');
      expect(JSON.stringify(card)).not.toContain('0987654321');
      expect(JSON.stringify(card)).not.toContain('u123456');
    });

    it('mã trên thẻ tra ra ĐÚNG thành viên đó qua endpoint quét của nhân viên (round-trip)', async () => {
      const { prisma } = makeFakeDb([
        { id: 'staff-1', role: 'STAFF', referralCode: 'STAFF001' },
        { id: 'm1', phone: '0987654321', referralCode: 'AB12CD34', fullName: 'Khách A' },
        { id: 'm2', phone: '0911654321', referralCode: 'FF00EE11', fullName: 'Khách B' },
      ]);
      const svc = new LoyaltyService(prisma, makeConfig());
      const card = await svc.getMemberCard('m1');
      const found = await svc.lookupMemberByStaff('staff-1', card.memberCode);
      expect(found.member.id).toBe('m1');
    });
  });

  // ───────────────────────────── Staff lookup ─────────────────────────────
  describe('Tra cứu thành viên (nhân viên)', () => {
    const staff = { id: 'staff-1', role: 'STAFF', isBlocked: false };
    function lookupPrisma(found: Row[] = []) {
      const findMany = jest.fn().mockResolvedValue(found);
      const prisma = {
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue(staff), findMany },
      } as unknown as PrismaService;
      return { prisma, findMany };
    }

    it('người gọi không phải STAFF/ADMIN (role trong DB) → Forbidden', async () => {
      const prisma = {
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u-cust', role: 'CUSTOMER' }) },
      } as unknown as PrismaService;
      await expect(new LoyaltyService(prisma, makeConfig()).lookupMemberByStaff('u-cust', 'TUBUAB12CD34')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it.each(['', '   ', 'TUBU', 'tubu', '1', 'TUBU21', 'AB1', '0987'])(
      'mã rỗng/quá ngắn "%s" → BadRequest, KHÔNG truy vấn DB (trước đây endsWith("") khớp MỌI user)',
      async (code) => {
        const { prisma, findMany } = lookupPrisma();
        await expect(new LoyaltyService(prisma, makeConfig()).lookupMemberByStaff('staff-1', code)).rejects.toThrow(
          BadRequestException,
        );
        expect(findMany).not.toHaveBeenCalled();
      },
    );

    it('chỉ khớp CHÍNH XÁC referralCode / SĐT đầy đủ — không endsWith, không theo id', async () => {
      const { prisma, findMany } = lookupPrisma([{ id: 'm1', referralCode: 'AB12CD34', phone: '0987654321' }]);
      await new LoyaltyService(prisma, makeConfig()).lookupMemberByStaff('staff-1', ' tubu-ab12cd34 ');
      const where = findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).not.toContain('endsWith');
      expect(JSON.stringify(where)).not.toContain('"id"');
      expect(where.OR).toEqual(expect.arrayContaining([{ referralCode: { in: expect.arrayContaining(['AB12CD34']) } }]));
      expect(findMany.mock.calls[0][0].take).toBe(2);
    });

    it('SĐT dạng 84xxxxxxxxx / +84 được chuẩn hoá về 0xxxxxxxxx và so khớp chính xác', async () => {
      const { prisma, findMany } = lookupPrisma([{ id: 'm1', referralCode: 'AB12CD34', phone: '0987654321' }]);
      await new LoyaltyService(prisma, makeConfig()).lookupMemberByStaff('staff-1', '+84 987 654 321');
      expect(findMany.mock.calls[0][0].where.OR).toEqual(expect.arrayContaining([{ phone: '0987654321' }]));
    });

    it('không thấy → NotFound', async () => {
      const { prisma } = lookupPrisma([]);
      await expect(new LoyaltyService(prisma, makeConfig()).lookupMemberByStaff('staff-1', 'TUBUAB12CD34')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('mơ hồ (2 thành viên khớp) → Conflict, không chọn bừa', async () => {
      // "TUBUAB123456" vừa là mã thô của m1, vừa là TUBU + mã của m2.
      const { prisma } = lookupPrisma([
        { id: 'm1', referralCode: 'TUBUAB123456', phone: null },
        { id: 'm2', referralCode: 'AB123456', phone: null },
      ]);
      await expect(new LoyaltyService(prisma, makeConfig()).lookupMemberByStaff('staff-1', 'TUBUAB123456')).rejects.toThrow(
        ConflictException,
      );
    });

    it('kết quả tra cứu chỉ trả SĐT đã che', async () => {
      const { prisma } = lookupPrisma([
        { id: 'm1', referralCode: 'AB12CD34', phone: '0987654321', fullName: 'Khách A', pointsBalance: 10, tier: null },
      ]);
      const res = await new LoyaltyService(prisma, makeConfig()).lookupMemberByStaff('staff-1', 'TUBUAB12CD34');
      expect(res.member.phone).toBe('098****321');
      expect(res.member.memberCode).toBe('TUBUAB12CD34');
    });
  });

  // ───────────────────────────── POS credit ─────────────────────────────
  describe('Tích điểm hoá đơn tại quầy (POS)', () => {
    const ENABLED = { 'loyalty.pos_credit_enabled': true };
    function posDb(extraUsers: Row[] = []) {
      return makeFakeDb([
        { id: 'staff-1', role: 'STAFF', referralCode: 'STAFF001', phone: '0900000001' },
        { id: 'staff-2', role: 'STAFF', referralCode: 'STAFF002', phone: '0900000002' },
        {
          id: 'm1',
          phone: '0912345678',
          referralCode: 'AB12CD34',
          fullName: 'Khách Vip',
          pointsBalance: 50,
          tier: { name: 'Lộc Biếc', pointMultiplier: 1.5 },
        },
        { id: 'm2', phone: '0912000000', referralCode: 'EE00FF11', fullName: 'Khách B' },
        ...extraUsers,
      ]);
    }
    const credit = (svc: LoyaltyService, staffId: string, over: Partial<{ memberCode: string; orderTotal: number; receiptId: string; note: string }> = {}) =>
      svc.creditPosPoints(staffId, { memberCode: 'TUBUAB12CD34', orderTotal: 200_000, receiptId: 'HD-001', ...over });

    it('mặc định TẮT (loyalty.pos_credit_enabled=false) → Forbidden, không ghi gì', async () => {
      const { db, prisma } = posDb();
      await expect(credit(new LoyaltyService(prisma, makeConfig()), 'staff-1')).rejects.toThrow(ForbiddenException);
      expect(db.posCredits).toHaveLength(0);
      expect(db.ledger).toHaveLength(0);
    });

    it('khách hàng thường gọi → Forbidden', async () => {
      const { prisma } = posDb();
      await expect(credit(new LoyaltyService(prisma, makeConfig(ENABLED)), 'm2')).rejects.toThrow(ForbiddenException);
    });

    it('nhân viên bị khoá → Forbidden', async () => {
      const { db, prisma } = posDb();
      db.users.get('staff-1')!.isBlocked = true;
      await expect(credit(new LoyaltyService(prisma, makeConfig(ENABLED)), 'staff-1')).rejects.toThrow(ForbiddenException);
    });

    it('nhân viên KHÔNG được tự tích điểm cho chính mình', async () => {
      const { db, prisma } = posDb();
      await expect(
        credit(new LoyaltyService(prisma, makeConfig(ENABLED)), 'staff-1', { memberCode: 'TUBUSTAFF001' }),
      ).rejects.toThrow(ForbiddenException);
      expect(db.users.get('staff-1')!.pointsBalance).toBe(0);
    });

    it('cộng điểm theo loyalty.vnd_per_point × hệ số hạng; ledger POS có expiresAt; sổ audit ghi nhân viên', async () => {
      const { db, prisma } = posDb();
      const svc = new LoyaltyService(prisma, makeConfig({ ...ENABLED, 'loyalty.vnd_per_point': 10_000 }));
      const res = await credit(svc, 'staff-1', { note: 'Quầy 1' });

      // 200.000 / 10.000 = 20 × 1,5 = 30 điểm
      expect(res.replayed).toBe(false);
      expect(res.posTransaction).toMatchObject({ receiptId: 'HD-001', orderTotal: 200_000, pointsEarned: 30 });
      expect(res.member.pointsBalance).toBe(80);
      expect(db.users.get('m1')!.pointsBalance).toBe(80);
      expect(db.posCredits).toEqual([
        expect.objectContaining({ receiptId: 'HD-001', memberId: 'm1', staffUserId: 'staff-1', orderTotal: 200_000, points: 30, note: 'Quầy 1' }),
      ]);
      const row = db.ledger[0]!;
      expect(row).toMatchObject({ userId: 'm1', delta: 30, reason: 'POS_OFFLINE_ORDER:HD-001', refType: 'POS', refId: db.posCredits[0]!.id });
      expect(row.expiresAt).toBeInstanceOf(Date);
    });

    it('hoá đơn vượt trần loyalty.pos_max_order_total → BadRequest', async () => {
      const { db, prisma } = posDb();
      const svc = new LoyaltyService(prisma, makeConfig({ ...ENABLED, 'loyalty.pos_max_order_total': 1_000_000 }));
      await expect(credit(svc, 'staff-1', { orderTotal: 1_000_001 })).rejects.toThrow(BadRequestException);
      expect(db.posCredits).toHaveLength(0);
    });

    it('hoá đơn quá nhỏ ra 0 điểm → BadRequest (không ghi dòng rỗng)', async () => {
      const { db, prisma } = posDb();
      await expect(credit(new LoyaltyService(prisma, makeConfig(ENABLED)), 'staff-1', { memberCode: 'TUBUEE00FF11', orderTotal: 5_000 })).rejects.toThrow(
        BadRequestException,
      );
      expect(db.posCredits).toHaveLength(0);
    });

    it('IDEMPOTENT: gửi lại cùng receiptId (retry mạng) → trả lại kết quả cũ, KHÔNG cộng lần 2', async () => {
      const { db, prisma } = posDb();
      const svc = new LoyaltyService(prisma, makeConfig(ENABLED));
      const first = await credit(svc, 'staff-1');
      const again = await credit(svc, 'staff-1');
      expect(again.replayed).toBe(true);
      expect(again.posTransaction.pointsEarned).toBe(first.posTransaction.pointsEarned);
      expect(db.users.get('m1')!.pointsBalance).toBe(80);
      expect(db.ledger).toHaveLength(1);
    });

    it('CONCURRENCY: 5 lần gửi song song cùng receiptId → đúng 1 lần cộng điểm', async () => {
      const { db, prisma } = posDb();
      const svc = new LoyaltyService(prisma, makeConfig(ENABLED));
      const results = await Promise.all(Array.from({ length: 5 }, () => credit(svc, 'staff-1')));
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);
      expect(db.users.get('m1')!.pointsBalance).toBe(80);
      expect(db.posCredits).toHaveLength(1);
      expect(db.ledger).toHaveLength(1);
    });

    it('receiptId đã dùng cho thành viên/số tiền KHÁC → Conflict', async () => {
      const { prisma } = posDb();
      const svc = new LoyaltyService(prisma, makeConfig(ENABLED));
      await credit(svc, 'staff-1');
      await expect(credit(svc, 'staff-1', { orderTotal: 300_000 })).rejects.toThrow(ConflictException);
      await expect(credit(svc, 'staff-2', { memberCode: 'TUBUEE00FF11' })).rejects.toThrow(ConflictException);
    });

    it('CONCURRENCY: trần điểm/ngày của NHÂN VIÊN giữ đúng khi nhiều hoá đơn gửi song song', async () => {
      const { db, prisma } = posDb();
      // m2 hạng thường ×1: mỗi hoá đơn 500k = 50 điểm; trần 100 điểm/NV/ngày → chỉ 2/3 hoá đơn qua.
      const svc = new LoyaltyService(
        prisma,
        makeConfig({ ...ENABLED, 'loyalty.pos_staff_daily_points_cap': 100, 'loyalty.pos_member_daily_points_cap': 10_000 }),
      );
      const results = await Promise.allSettled(
        ['HD-A', 'HD-B', 'HD-C'].map((receiptId) =>
          credit(svc, 'staff-1', { memberCode: 'TUBUEE00FF11', orderTotal: 500_000, receiptId }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
      const rej = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rej.reason).toBeInstanceOf(BadRequestException);
      expect(db.users.get('m2')!.pointsBalance).toBe(100);
    });

    it('sổ audit (admin): lọc theo ngày/nhân viên, mới nhất trước, có trần số dòng, SĐT đã che', async () => {
      const findMany = jest.fn().mockResolvedValue([
        {
          id: 'pos-1',
          receiptId: 'HD-001',
          orderTotal: 200_000,
          points: 30,
          multiplier: new Prisma.Decimal(1.5),
          note: 'Quầy 1',
          dayKey: '2026-09-27',
          createdAt: new Date('2026-09-27T03:00:00Z'),
          staff: { id: 'staff-1', fullName: 'NV A', phone: '0900000001' },
          member: { id: 'm1', fullName: 'Khách Vip', phone: '0912345678', referralCode: 'AB12CD34' },
        },
      ]);
      const prisma = { posPointCredit: { findMany } } as unknown as PrismaService;
      const rows = await new LoyaltyService(prisma, makeConfig()).listPosCredits({ day: '2026-09-27', staffUserId: 'staff-1' });

      const arg = findMany.mock.calls[0][0];
      expect(arg.where).toEqual({ dayKey: '2026-09-27', staffUserId: 'staff-1' });
      expect(arg.orderBy).toEqual({ createdAt: 'desc' });
      expect(arg.take).toBeLessThanOrEqual(200);
      expect(rows[0]).toMatchObject({
        receiptId: 'HD-001',
        points: 30,
        multiplier: 1.5,
        staff: { id: 'staff-1', name: 'NV A', phone: '090****001' },
        member: { id: 'm1', name: 'Khách Vip', phone: '091****678', memberCode: 'TUBUAB12CD34' },
      });
      expect(JSON.stringify(rows)).not.toContain('0912345678');
    });

    it('trần điểm/ngày của THÀNH VIÊN áp trên mọi nhân viên cộng lại', async () => {
      const { db, prisma } = posDb();
      const svc = new LoyaltyService(
        prisma,
        makeConfig({ ...ENABLED, 'loyalty.pos_staff_daily_points_cap': 10_000, 'loyalty.pos_member_daily_points_cap': 60 }),
      );
      await credit(svc, 'staff-1', { memberCode: 'TUBUEE00FF11', orderTotal: 500_000, receiptId: 'HD-1' });
      await expect(
        credit(svc, 'staff-2', { memberCode: 'TUBUEE00FF11', orderTotal: 200_000, receiptId: 'HD-2' }),
      ).rejects.toThrow(BadRequestException);
      expect(db.users.get('m2')!.pointsBalance).toBe(50);
    });
  });
});
