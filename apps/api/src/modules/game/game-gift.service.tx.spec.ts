import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GameGiftService } from './game-gift.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';

// ─────────────────────────────────────────────────────────────────────────────
// Fake DB in-memory cho giftWater, mô phỏng đúng những bảo đảm Postgres mà code dựa vào:
//  - mọi thao tác nhường event-loop (await tick) TRƯỚC khi đọc/ghi → các lần tặng song song XEN KẼ thật;
//  - unique water_gifts(senderId, recipientId, dayKey) ném P2002; kẻ insert sau chờ kẻ insert trước kết thúc tx
//    (thắng → P2002, huỷ → được insert), đúng cách unique index Postgres chờ xid chưa commit;
//  - updateMany với guard `totalSeeds.gte` là 1 câu lệnh atomic; dòng đã ghi bị KHOÁ tới hết tx, người ghi sau chờ
//    rồi mới đọc lại giá trị đã commit (READ COMMITTED);
//  - $transaction giữ ảnh gốc từng dòng đã ghi và KHÔI PHỤC khi callback ném (rollback). Ảnh gốc theo dòng, không theo
//    cả DB: tx khác đã commit dòng khác trong lúc này không bị đè;
//  - tx chờ khoá do tx khác giữ trong khi tx kia (trực tiếp hay qua chuỗi) đang chờ khoá của mình → thao tác ghi của tx
//    này ném lỗi mã 40P01 (deadlock detected) thay vì treo; tx bị chọn huỷ rollback rồi tx kia chạy tiếp, như Postgres.
// ─────────────────────────────────────────────────────────────────────────────
const tick = () => new Promise<void>((r) => setImmediate(r));

const p2002 = (target: string) =>
  new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on ${target}`, {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });

const deadlock = () => Object.assign(new Error('deadlock detected'), { code: '40P01' });

interface Profile {
  userId: string;
  totalSeeds: number;
  ecoImpact?: unknown;
}
interface Gift {
  senderId: string;
  recipientId: string;
  amount: number;
  dayKey: string;
}
interface Tx {
  id: number;
  undo: Array<() => void>;
}
interface FakeUser {
  id: string;
  referredById: string | null;
  fullName: string;
}

const GIFTED_MSG = 'Hôm nay bạn đã tặng nước cho người này rồi 🌿';
const NEED_MSG = 'Cần 10💧 để tặng nước.';

class FakeGiftDb {
  profiles = new Map<string, Profile>();
  gifts: Gift[] = [];
  users: FakeUser[] = [];
  /** Nhật ký thao tác để chứng minh các lần gọi thật sự xen kẽ và rollback có việc để làm. */
  log: string[] = [];
  openTx = 0;
  /** Trả Error để thao tác tương ứng ném (sau khi đã nhường event-loop). */
  failAt: (op: string, args: Record<string, unknown>) => Error | undefined = () => undefined;

  private locks = new Map<string, number>();
  /** tx đang chờ → tx đang giữ khoá nó cần (đồ thị chờ để phát hiện deadlock). */
  private waitingFor = new Map<number, number>();
  private txSeq = 0;

  seed(opts: { sender: number; friends: Record<string, number | null> }) {
    this.users = [{ id: 'u1', referredById: null, fullName: 'Lã Sender' }];
    this.profiles.set('u1', { userId: 'u1', totalSeeds: opts.sender });
    for (const [id, seeds] of Object.entries(opts.friends)) {
      this.users.push({ id, referredById: 'u1', fullName: `Bạn ${id}` });
      if (seeds !== null) this.profiles.set(id, { userId: id, totalSeeds: seeds });
    }
  }

  seedUsers(users: FakeUser[], seeds: Record<string, number>) {
    this.users = users;
    for (const [id, totalSeeds] of Object.entries(seeds)) this.profiles.set(id, { userId: id, totalSeeds });
  }

  seeds(userId: string): number | undefined {
    return this.profiles.get(userId)?.totalSeeds;
  }

  private maybeFail(op: string, args: Record<string, unknown>) {
    const err = this.failAt(op, args);
    if (err) throw err;
  }

  private wouldDeadlock(txId: number, holder: number): boolean {
    for (let cur: number | undefined = holder; cur !== undefined; cur = this.waitingFor.get(cur)) {
      if (cur === txId) return true;
    }
    return false;
  }

  // Kiểm khoá, lấy khoá, chạy `fn` trong CÙNG một đoạn đồng bộ: không có chỗ hở cho tx khác chen vào.
  private async withRow<T>(key: string, tx: Tx | null, fn: () => T): Promise<T> {
    for (;;) {
      const holder = this.locks.get(key);
      if (holder === undefined || holder === tx?.id) break;
      if (tx) {
        if (this.wouldDeadlock(tx.id, holder)) {
          this.waitingFor.delete(tx.id);
          throw deadlock();
        }
        this.waitingFor.set(tx.id, holder);
      }
      await tick();
    }
    if (tx) {
      this.waitingFor.delete(tx.id);
      this.locks.set(key, tx.id);
    }
    return fn();
  }

  private release(tx: Tx) {
    for (const [key, holder] of [...this.locks]) if (holder === tx.id) this.locks.delete(key);
  }

  client(tx: Tx | null) {
    return {
      user: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          await tick();
          const u = this.users.find((x) => x.id === where.id);
          return u ? { referredById: u.referredById } : null;
        },
        findMany: async ({ where }: { where: { referredById: string } }) => {
          await tick();
          return this.users.filter((u) => u.referredById === where.referredById).map((u) => ({ id: u.id, fullName: u.fullName }));
        },
      },
      waterGift: {
        create: async ({ data }: { data: Gift }) => {
          this.log.push(`gift.create:${data.recipientId}`);
          await tick();
          this.maybeFail('waterGift.create', { ...data });
          const key = `gift:${data.senderId}:${data.recipientId}:${data.dayKey}`;
          return this.withRow(key, tx, () => {
            const clash = this.gifts.some(
              (g) => g.senderId === data.senderId && g.recipientId === data.recipientId && g.dayKey === data.dayKey,
            );
            if (clash) throw p2002('water_gifts(senderId, recipientId, dayKey)');
            const row = { ...data };
            this.gifts.push(row);
            tx?.undo.push(() => {
              this.gifts = this.gifts.filter((g) => g !== row);
            });
            return { ...row };
          });
        },
      },
      gameProfile: {
        updateMany: async ({
          where,
          data,
        }: {
          where: { userId: string; totalSeeds?: { gte: number } };
          data: { totalSeeds: { decrement: number } };
        }) => {
          await tick();
          this.maybeFail('gameProfile.updateMany', { where, data });
          return this.withRow(`profile:${where.userId}`, tx, () => {
            const p = this.profiles.get(where.userId);
            const gte = where.totalSeeds?.gte;
            if (!p || (gte !== undefined && p.totalSeeds < gte)) return { count: 0 };
            const before = p.totalSeeds;
            p.totalSeeds -= data.totalSeeds.decrement;
            this.log.push(`debit:${where.userId}`);
            tx?.undo.push(() => {
              p.totalSeeds = before;
            });
            return { count: 1 };
          });
        },
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { userId: string };
          create: Profile;
          update: { totalSeeds: { increment: number } };
        }) => {
          await tick();
          this.maybeFail('gameProfile.upsert', { where, create, update });
          return this.withRow(`profile:${where.userId}`, tx, () => {
            const p = this.profiles.get(where.userId);
            if (!p) {
              const row = { ...create };
              this.profiles.set(where.userId, row);
              this.log.push(`credit:${where.userId}`);
              tx?.undo.push(() => {
                this.profiles.delete(where.userId);
              });
              return { ...row };
            }
            const before = p.totalSeeds;
            p.totalSeeds += update.totalSeeds.increment;
            this.log.push(`credit:${where.userId}`);
            tx?.undo.push(() => {
              p.totalSeeds = before;
            });
            return { ...p };
          });
        },
      },
      // clampTankKeepingOverflow: UPDATE ... SET totalSeeds = GREATEST(cap, totalSeeds - added) WHERE totalSeeds > cap
      $executeRaw: async (_strings: TemplateStringsArray, cap: number, added: number, userId: string) => {
        await tick();
        this.maybeFail('$executeRaw', { cap, added, userId });
        return this.withRow(`profile:${userId}`, tx, () => {
          const p = this.profiles.get(userId);
          if (!p || p.totalSeeds <= cap) return 0;
          const before = p.totalSeeds;
          p.totalSeeds = Math.max(cap, p.totalSeeds - added);
          tx?.undo.push(() => {
            p.totalSeeds = before;
          });
          return 1;
        });
      },
    };
  }

  async $transaction<T>(cb: (tx: ReturnType<FakeGiftDb['client']>) => Promise<T>): Promise<T> {
    await tick();
    const tx: Tx = { id: ++this.txSeq, undo: [] };
    this.openTx++;
    try {
      const result = await cb(this.client(tx));
      this.log.push('commit');
      return result;
    } catch (e) {
      for (const undo of tx.undo.reverse()) undo();
      this.log.push('rollback');
      throw e;
    } finally {
      this.release(tx);
      this.waitingFor.delete(tx.id);
      this.openTx--;
    }
  }
}

const config = {
  get: async <T>(_k: string, fb?: T): Promise<T> => fb as T,
} as unknown as SystemConfigService;

function setup(seed: { sender: number; friends: Record<string, number | null> }) {
  const db = new FakeGiftDb();
  db.seed(seed);
  return setup2(db);
}

function setup2(db: FakeGiftDb) {
  const prisma = {
    ...db.client(null),
    $transaction: db.$transaction.bind(db),
  } as unknown as PrismaService;
  let notifiedWhileTxOpen = false;
  const notifySafe = jest.fn(async () => {
    if (db.openTx > 0) notifiedWhileTxOpen = true;
  });
  const notifications = { notify: notifySafe, notifySafe } as unknown as NotificationsService;
  return {
    db,
    svc: new GameGiftService(prisma, config, notifications),
    notifySafe,
    notifiedWhileTxOpen: () => notifiedWhileTxOpen,
  };
}

const MODES = [
  // 'u1' < 'w1': trừ người gửi rồi mới cộng người nhận.
  { name: 'người gửi < người nhận (trừ rồi cộng)', recipient1: 'w1', recipient2: 'w2', debitFirst: true },
  // 'u1' > 'f1': cộng người nhận rồi mới trừ người gửi.
  { name: 'người gửi > người nhận (cộng rồi trừ)', recipient1: 'f1', recipient2: 'f2', debitFirst: false },
];

const profileWrites = (log: string[]) => log.filter((l) => /^(debit|credit):/.test(l));

describe.each(MODES)(
  'GameGiftService.giftWater — một transaction cho gift + trừ người gửi + cộng người nhận, $name',
  ({ recipient1: F1, recipient2: F2, debitFirst }) => {
    it('thành công: một dòng gift, người gửi -10, người nhận +10, ghi theo thứ tự userId, báo SAU khi commit', async () => {
      const t = setup({ sender: 100, friends: { [F1]: 20 } });
      const r = await t.svc.giftWater('u1', F1);
      expect(r).toEqual({ amount: 10, recipientId: F1 });
      expect(t.db.gifts).toEqual([expect.objectContaining({ senderId: 'u1', recipientId: F1, amount: 10 })]);
      expect(t.db.seeds('u1')).toBe(90);
      expect(t.db.seeds(F1)).toBe(30);
      expect(profileWrites(t.db.log)).toEqual(debitFirst ? ['debit:u1', `credit:${F1}`] : [`credit:${F1}`, 'debit:u1']);
      expect(t.notifySafe).toHaveBeenCalledTimes(1);
      expect(t.notifySafe).toHaveBeenCalledWith(F1, 'GAME_WATER_GIFT', { amount: '10' });
      expect(t.notifiedWhileTxOpen()).toBe(false);
    });

    it('người nhận chưa có hồ sơ: tạo hồ sơ với số nước tặng', async () => {
      const t = setup({ sender: 100, friends: { [F1]: null } });
      await t.svc.giftWater('u1', F1);
      expect(t.db.seeds('u1')).toBe(90);
      expect(t.db.seeds(F1)).toBe(10);
    });

    describe('(a) lỗi ở bước cộng người nhận → huỷ cả ba, lỗi ném nguyên văn', () => {
      it('upsert người nhận sập: người gửi KHÔNG mất nước, không còn dòng gift, lỗi không bị gắn nhãn "đã tặng"', async () => {
        const t = setup({ sender: 100, friends: { [F1]: 20 } });
        t.db.failAt = (op) => (op === 'gameProfile.upsert' ? new Error('db down') : undefined);

        const err = await t.svc.giftWater('u1', F1).then(
          () => null,
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(BadRequestException);
        expect((err as Error).message).toBe('db down');
        // Có việc đã ghi trước khi sập (dòng gift, và khoản trừ nếu trừ đi trước): rollback có gì để hoàn.
        expect(t.db.log).toContain(`gift.create:${F1}`);
        expect(t.db.log.includes('debit:u1')).toBe(debitFirst);
        expect(t.db.log).toContain('rollback');
        expect(t.db.log).not.toContain('commit');
        expect(t.db.seeds('u1')).toBe(100);
        expect(t.db.seeds(F1)).toBe(20);
        expect(t.db.gifts).toEqual([]);
        expect(t.notifySafe).not.toHaveBeenCalled();
      });

      it('P2002 ở bước cộng người nhận (không phải unique của gift) cũng không bị gắn nhãn "đã tặng"', async () => {
        const t = setup({ sender: 100, friends: { [F1]: 20 } });
        t.db.failAt = (op) => (op === 'gameProfile.upsert' ? p2002('game_profiles(userId)') : undefined);
        const err = await t.svc.giftWater('u1', F1).then(
          () => null,
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        expect(err).not.toBeInstanceOf(BadRequestException);
        expect(t.db.seeds('u1')).toBe(100);
        expect(t.db.seeds(F1)).toBe(20);
        expect(t.db.gifts).toEqual([]);
      });

      it('clamp sau khi cộng sập (người nhận gần đầy): phần đã cộng cũng được huỷ', async () => {
        const t = setup({ sender: 100, friends: { [F1]: 495 } });
        t.db.failAt = (op) => (op === '$executeRaw' ? new Error('clamp failed') : undefined);
        await expect(t.svc.giftWater('u1', F1)).rejects.toThrow('clamp failed');
        expect(t.db.log).toContain(`credit:${F1}`);
        expect(t.db.log.includes('debit:u1')).toBe(debitFirst);
        expect(t.db.log).toContain('rollback');
        expect(t.db.seeds('u1')).toBe(100);
        expect(t.db.seeds(F1)).toBe(495);
        expect(t.db.gifts).toEqual([]);
      });

      it('người nhận gần đầy, không lỗi: cộng rồi kẹp về trần, giữ phần vượt sẵn', async () => {
        const t = setup({ sender: 100, friends: { [F1]: 495 } });
        await t.svc.giftWater('u1', F1);
        expect(t.db.seeds(F1)).toBe(500);
        expect(t.db.seeds('u1')).toBe(90);
      });
    });

    describe('(b) lỗi khác ném nguyên văn, không gắn nhãn "đã tặng hôm nay"', () => {
      it('trừ nước người gửi sập: lỗi nguyên văn, không còn dòng gift, số dư không đổi (kể cả phần đã cộng nếu cộng trước)', async () => {
        const t = setup({ sender: 100, friends: { [F1]: 20 } });
        t.db.failAt = (op) => (op === 'gameProfile.updateMany' ? new Error('deadlock detected') : undefined);
        const err = await t.svc.giftWater('u1', F1).then(
          () => null,
          (e: unknown) => e,
        );
        expect(err).not.toBeInstanceOf(BadRequestException);
        expect((err as Error).message).toBe('deadlock detected');
        expect(t.db.log).toContain(`gift.create:${F1}`);
        expect(t.db.log.includes(`credit:${F1}`)).toBe(!debitFirst);
        expect(t.db.log).toContain('rollback');
        expect(t.db.seeds('u1')).toBe(100);
        expect(t.db.seeds(F1)).toBe(20);
        expect(t.db.gifts).toEqual([]);
      });

      it('tạo dòng gift sập vì lỗi không phải unique: lỗi nguyên văn', async () => {
        const t = setup({ sender: 100, friends: { [F1]: 20 } });
        t.db.failAt = (op) => (op === 'waterGift.create' ? new Error('connection reset') : undefined);
        const err = await t.svc.giftWater('u1', F1).then(
          () => null,
          (e: unknown) => e,
        );
        expect(err).not.toBeInstanceOf(BadRequestException);
        expect((err as Error).message).toBe('connection reset');
        expect(t.db.seeds('u1')).toBe(100);
        expect(t.db.seeds(F1)).toBe(20);
      });
    });

    describe('(c) 5 lần tặng song song cùng (người gửi, người nhận, ngày)', () => {
      it('đúng 1 dòng gift, 1 lần trừ, 1 lần cộng; 4 lần còn lại ăn lỗi "đã tặng hôm nay"', async () => {
        const t = setup({ sender: 100, friends: { [F1]: 20 } });
        const results = await Promise.allSettled(Array.from({ length: 5 }, () => t.svc.giftWater('u1', F1)));

        const ok = results.filter((r) => r.status === 'fulfilled');
        const bad = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(ok).toHaveLength(1);
        expect(bad).toHaveLength(4);
        for (const r of bad) {
          expect(r.reason).toBeInstanceOf(BadRequestException);
          expect((r.reason as BadRequestException).message).toBe(GIFTED_MSG);
          expect((r.reason as BadRequestException).getStatus()).toBe(400);
        }
        expect(t.db.gifts).toHaveLength(1);
        expect(t.db.seeds('u1')).toBe(90);
        expect(t.db.seeds(F1)).toBe(30);
        expect(t.db.log.filter((l) => l === 'debit:u1')).toHaveLength(1);
        expect(t.db.log.filter((l) => l === `credit:${F1}`)).toHaveLength(1);
        expect(t.notifySafe).toHaveBeenCalledTimes(1);

        // Không rỗng tuếch: cả 5 lần đã cùng chen vào chèn dòng gift TRƯỚC khi lần đầu kịp commit.
        const attempts = t.db.log.map((l, i) => (l === `gift.create:${F1}` ? i : -1)).filter((i) => i >= 0);
        expect(attempts).toHaveLength(5);
        expect(Math.max(...attempts)).toBeLessThan(t.db.log.indexOf('commit'));
      });

      it('lần tặng thứ hai sau khi lần đầu đã commit cũng ăn lỗi đã tặng, số dư không đổi thêm', async () => {
        const t = setup({ sender: 100, friends: { [F1]: 20 } });
        await t.svc.giftWater('u1', F1);
        await expect(t.svc.giftWater('u1', F1)).rejects.toMatchObject({ message: GIFTED_MSG });
        expect(t.db.gifts).toHaveLength(1);
        expect(t.db.seeds('u1')).toBe(90);
        expect(t.db.seeds(F1)).toBe(30);
      });
    });

    describe('(d) người nhận khác nhau song song', () => {
      it('cả hai thành công: hai dòng gift, người gửi -20, mỗi người nhận +10', async () => {
        const t = setup({ sender: 100, friends: { [F1]: 20, [F2]: 30 } });
        const results = await Promise.allSettled([t.svc.giftWater('u1', F1), t.svc.giftWater('u1', F2)]);
        expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
        expect(t.db.gifts.map((g) => g.recipientId).sort()).toEqual([F1, F2]);
        expect(t.db.seeds('u1')).toBe(80);
        expect(t.db.seeds(F1)).toBe(30);
        expect(t.db.seeds(F2)).toBe(40);
        expect(t.notifySafe).toHaveBeenCalledTimes(2);
      });

      it('nước chỉ đủ cho một lần: một lần thắng, lần kia ăn lỗi thiếu nước, dòng gift và phần đã cộng của nó bị huỷ', async () => {
        const t = setup({ sender: 15, friends: { [F1]: 20, [F2]: 30 } });
        const results = await Promise.allSettled([t.svc.giftWater('u1', F1), t.svc.giftWater('u1', F2)]);
        const ok = results.filter((r) => r.status === 'fulfilled');
        const bad = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(ok).toHaveLength(1);
        expect(bad).toHaveLength(1);
        expect((bad[0]!.reason as BadRequestException).message).toBe(NEED_MSG);
        expect(t.db.gifts).toHaveLength(1);
        expect(t.db.seeds('u1')).toBe(5);
        // Đúng một người nhận được nước, người còn lại giữ nguyên.
        const winner = t.db.gifts[0]!.recipientId;
        const loser = winner === F1 ? F2 : F1;
        expect(t.db.seeds(winner)).toBe(winner === F1 ? 30 : 40);
        expect(t.db.seeds(loser)).toBe(loser === F1 ? 20 : 30);
      });
    });

    describe('(e) không đủ nước', () => {
      it('giữ nguyên lỗi cũ, không còn dòng gift, người nhận không được cộng, không báo', async () => {
        const t = setup({ sender: 5, friends: { [F1]: 20 } });
        const err = await t.svc.giftWater('u1', F1).then(
          () => null,
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).message).toBe(NEED_MSG);
        expect((err as BadRequestException).getStatus()).toBe(400);
        expect(t.db.gifts).toEqual([]);
        expect(t.db.seeds('u1')).toBe(5);
        expect(t.db.seeds(F1)).toBe(20);
        // Cộng trước thì khoản cộng đã chạy rồi bị huỷ; trừ trước thì chưa từng cộng.
        expect(t.db.log.includes(`credit:${F1}`)).toBe(!debitFirst);
        expect(t.notifySafe).not.toHaveBeenCalled();
      });

      it('hết nước rồi mới có thêm nước: lần tặng sau đó thành công (dòng gift lần trước không còn chặn)', async () => {
        const t = setup({ sender: 5, friends: { [F1]: 20 } });
        await expect(t.svc.giftWater('u1', F1)).rejects.toMatchObject({ message: NEED_MSG });
        t.db.profiles.get('u1')!.totalSeeds = 50;
        await t.svc.giftWater('u1', F1);
        expect(t.db.gifts).toHaveLength(1);
        expect(t.db.seeds('u1')).toBe(40);
        expect(t.db.seeds(F1)).toBe(30);
      });
    });
  },
);

describe('GameGiftService.giftWater — A tặng B cùng lúc B tặng A không deadlock', () => {
  // referrer = người mời (id nhỏ hay lớn tuỳ ca): hai bên là bạn của nhau qua đúng một liên kết giới thiệu.
  it.each([
    ['A < B, A tặng trước', 'u1', 'u2'],
    ['A > B, A tặng trước', 'u2', 'u1'],
  ])('%s: cả hai thành công, số dư đúng, không 40P01', async (_label, a, b) => {
    const db = new FakeGiftDb();
    db.seedUsers(
      [
        { id: a, referredById: null, fullName: 'Người A' },
        { id: b, referredById: a, fullName: 'Người B' },
      ],
      { [a]: 100, [b]: 50 },
    );
    const t = setup2(db);
    const results = await Promise.allSettled([t.svc.giftWater(a, b), t.svc.giftWater(b, a)]);

    const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => r.reason as { code?: string; message: string });
    expect(errors.map((e) => e.code ?? e.message)).toEqual([]);
    expect(db.log).not.toContain('rollback');
    expect(db.gifts.map((g) => `${g.senderId}>${g.recipientId}`).sort()).toEqual([`${a}>${b}`, `${b}>${a}`].sort());
    // Mỗi bên trừ 10 và nhận 10: số dư về đúng như cũ, và cả bốn lần ghi đều đã chạy.
    expect(db.seeds(a)).toBe(100);
    expect(db.seeds(b)).toBe(50);
    expect(db.log.filter((l) => l.startsWith('debit:'))).toHaveLength(2);
    expect(db.log.filter((l) => l.startsWith('credit:'))).toHaveLength(2);
    expect(t.notifySafe).toHaveBeenCalledTimes(2);
    // Không rỗng tuếch: lần tặng thứ hai đã bắt đầu trước khi lần đầu commit (hai tx chồng nhau thật).
    const creates = db.log.map((l, i) => (l.startsWith('gift.create:') ? i : -1)).filter((i) => i >= 0);
    expect(creates).toHaveLength(2);
    expect(Math.max(...creates)).toBeLessThan(db.log.indexOf('commit'));
  });

  it('người gửi có id lớn hơn người nhận và không đủ nước: đúng lời cũ, cộng người nhận đã chạy rồi bị huỷ cùng dòng gift', async () => {
    const db = new FakeGiftDb();
    db.seedUsers(
      [
        { id: 'u9', referredById: null, fullName: 'Người gửi' },
        { id: 'u1', referredById: 'u9', fullName: 'Người nhận' },
      ],
      { u9: 5, u1: 20 },
    );
    const t = setup2(db);
    const err = await t.svc.giftWater('u9', 'u1').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe(NEED_MSG);
    expect((err as BadRequestException).getStatus()).toBe(400);
    // Cộng đi trước (u9 > u1) rồi mới tới bước trừ thất bại: rollback có phần cộng để hoàn.
    expect(profileWrites(db.log)).toEqual(['credit:u1']);
    expect(db.log.indexOf('credit:u1')).toBeLessThan(db.log.indexOf('rollback'));
    expect(db.log).not.toContain('commit');
    expect(db.gifts).toEqual([]);
    expect(db.seeds('u9')).toBe(5);
    expect(db.seeds('u1')).toBe(20);
    expect(t.notifySafe).not.toHaveBeenCalled();
  });
});

describe('FakeGiftDb — bộ phát hiện deadlock (chứng minh kiểm thử trên không rỗng tuếch)', () => {
  it('hai tx khoá hai dòng theo thứ tự ngược nhau: một bên ăn 40P01, bên kia chạy xong', async () => {
    const db = new FakeGiftDb();
    db.seedUsers([], { A: 100, B: 100 });
    const debit = (tx: ReturnType<FakeGiftDb['client']>, userId: string) =>
      tx.gameProfile.updateMany({ where: { userId, totalSeeds: { gte: 1 } }, data: { totalSeeds: { decrement: 1 } } });
    const results = await Promise.allSettled([
      db.$transaction(async (tx) => {
        await debit(tx, 'A');
        await debit(tx, 'B');
      }),
      db.$transaction(async (tx) => {
        await debit(tx, 'B');
        await debit(tx, 'A');
      }),
    ]);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0]!.reason as { code: string }).code).toBe('40P01');
    // Bên bị huỷ đã hoàn khoản trừ của nó; bên thắng giữ cả hai khoản trừ.
    expect(db.seeds('A')! + db.seeds('B')!).toBe(198);
  });
});
