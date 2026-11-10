import { ConflictException, HttpException, Logger } from '@nestjs/common';
import { tick } from '../../../test/fakes/race-db.fake';
import {
  createRedeemWorld,
  deliveredOrder,
  giftRow,
  lotRow,
  userRow,
  voucherGiftRow,
  warehouseRow,
  type RedeemWorld,
} from '../../../test/fakes/w100a-helpers';
import { LoyaltyController } from './loyalty.controller';
import type { LoyaltyService } from './loyalty.service';

/**
 * Đổi Điểm Xanh lấy quà bị nhiều bên chạm cùng lúc (Postgres READ COMMITTED, xem test/fakes/race-db.fake.ts và w100a-helpers.ts).
 * LoyaltyService.redeemReward, creditOrderPoints, reverseOrderPoints, LoyaltyExpiryService.expireUser (hàm private của cron) và
 * WasteAdminGiftsService.update đều là mã THẬT chạy trên DB giả có khoá dòng + xét lại WHERE sau khoá; chỉ recalcTier bị bỏ.
 * Không phải mã thật: câu SQL thô được dựng lại bằng handler (khoá dòng users, trừ tồn kho, điểm đang khoá của đơn); DB giả không mô phỏng
 * khoá chia sẻ, KEY SHARE của khoá ngoại, deadlock, pool kết nối, timeout. Thứ này nằm ở test/integration-race (Postgres thật, CI race.yml).
 *
 * Mọi test "cùng một khách" bị khoá dòng users xếp hàng nên chạy tuần tự về mặt guard; test nào chỉ chứng minh "có ít nhất một khoá"
 * thì nói rõ ở tên, và có test riêng bỏ khoá dòng users (`userLock: false`) để chứng minh từng tầng còn lại.
 */
const delay = async (n: number) => {
  for (let i = 0; i < n; i++) await tick();
};
const is = (label: string, actual: unknown, expected: unknown) => expect({ label, actual }).toEqual({ label, actual: expected });
const SWEEP = Array.from({ length: 81 }, (_, i) => i - 40);
const WIDE_SWEEP = Array.from({ length: 121 }, (_, i) => i - 60);

const SOLD_OUT = 'Quà này đã hết hoặc đã ngừng đổi';
const HAS_VIETNAMESE = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

const raceBy = <A, B>(skew: number, a: () => Promise<A>, b: () => Promise<B>) =>
  Promise.allSettled([(async () => (await delay(Math.max(skew, 0)), a()))(), (async () => (await delay(Math.max(-skew, 0)), b()))()]) as Promise<
    [PromiseSettledResult<A>, PromiseSettledResult<B>]
  >;
const ok = <T>(r: PromiseSettledResult<T>): T => {
  if (r.status !== 'fulfilled') throw new Error(`mong thành công nhưng bị từ chối: ${String((r.reason as Error)?.message ?? r.reason)}`);
  return r.value;
};
const failure = (r: PromiseSettledResult<unknown>): HttpException => {
  if (r.status !== 'rejected') throw new Error('mong bị từ chối nhưng đã thành công');
  if (!(r.reason instanceof HttpException)) throw new Error(`lỗi không phải HttpException: ${String((r.reason as Error)?.message ?? r.reason)}`);
  return r.reason;
};
const status = (r: PromiseSettledResult<unknown>) => failure(r).getStatus();
const message = (r: PromiseSettledResult<unknown>) => failure(r).message;

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

type Row = Record<string, any>;
const balance = (w: RedeemWorld, id = 'u1') => w.db.row('user', id)!.pointsBalance as number;
const stock = (w: RedeemWorld, id = 'g1') => w.db.row('wasteGift', id)!.stock as number | null;
const ledger = (w: RedeemWorld, id = 'u1') => w.db.rows('pointsTransaction').filter((t) => t.userId === id);
const spendRows = (w: RedeemWorld, id = 'u1') => ledger(w, id).filter((t) => /^(GIFT_REDEEM|LOYALTY_REDEEM_VOUCHER):/.test(t.reason));
const redemptions = (w: RedeemWorld) => w.db.rows('wasteGiftRedemption');
const coupons = (w: RedeemWorld) => w.db.rows('coupon');
const events = (w: RedeemWorld, kind: string) => w.db.rows('wasteEvent').filter((e) => e.kind === kind);

/** Khách có `lots` (số = một lô mở đầu) trong sổ, số dư khớp tổng sổ; thêm quà và kho. */
function seedUser(w: RedeemWorld, id: string, lots: number | Row[], over: Row = {}) {
  const rows = typeof lots === 'number' ? (lots > 0 ? [lotRow(`open-${id}`, id, lots, 30, 365)] : []) : lots;
  w.db.seed('user', [userRow(id, rows.reduce((s, r) => s + r.delta, 0), over)]);
  w.db.seed('pointsTransaction', rows);
}
const seedGifts = (w: RedeemWorld, ...gifts: Row[]) => w.db.seed('wasteGift', gifts);

/**
 * Bất biến sau MỌI lần chạy: số dư không âm và bằng tổng sổ; tồn kho không âm; mỗi lượt đổi có đúng một dòng sổ trừ đúng giá của nó
 * (dòng sổ đi theo mã giảm giá với quà voucher, theo lượt đổi với quà vật lý); mỗi quà voucher có đúng một mã.
 */
function consistent(w: RedeemWorld, label: string) {
  for (const u of w.db.rows('user')) {
    is(`${label} số dư ${u.id} không âm`, u.pointsBalance >= 0, true);
    is(`${label} số dư ${u.id} = tổng sổ`, u.pointsBalance, ledger(w, u.id).reduce((s, t) => s + t.delta, 0));
  }
  for (const g of w.db.rows('wasteGift')) is(`${label} tồn ${g.id} không âm`, g.stock === null || g.stock >= 0, true);
  const spends = w.db.rows('pointsTransaction').filter((t) => /^(GIFT_REDEEM|LOYALTY_REDEEM_VOUCHER):/.test(t.reason));
  is(`${label} số dòng sổ trừ = số lượt đổi`, spends.length, redemptions(w).length);
  for (const r of redemptions(w)) {
    const refId = r.giftKind === 'VOUCHER' ? r.couponId : r.id;
    const mine = spends.filter((t) => t.userId === r.userId && t.refId === refId);
    is(`${label} lượt ${r.id} có đúng một dòng sổ`, mine.length, 1);
    is(`${label} lượt ${r.id} trừ đúng giá ghi trên lượt đổi`, mine[0]?.delta, -r.pointsCost);
  }
  is(`${label} số mã = số lượt đổi voucher`, coupons(w).length, redemptions(w).filter((r) => r.giftKind === 'VOUCHER').length);
}

const key = (n: number | string) => `redeem-key-${n}`;

describe('Đổi Điểm Xanh lấy quà — idempotency', () => {
  it.each(['GIFT', 'VOUCHER'] as const)(
    'cùng khoá, cùng quà %s, hai lần bấm sát nhau (quét thời điểm): một lượt đổi, một lần trừ điểm, hai bên nhận cùng kết quả',
    async (kind) => {
      let waits = 0;
      for (const skew of SWEEP) {
        const w = createRedeemWorld();
        seedUser(w, 'u1', 1000);
        seedGifts(w, kind === 'VOUCHER' ? voucherGiftRow('g1', { stock: 5 }) : giftRow('g1', { stock: 5 }));
        w.db.seed('wastePoint', [warehouseRow]);
        const label = `skew ${skew}`;

        const [a, b] = await raceBy(skew, () => w.loyalty.redeemReward('u1', 'g1', key(1)), () => w.loyalty.redeemReward('u1', 'g1', key(1)));

        const [ra, rb] = [ok(a), ok(b)];
        is(label, ra.redemption.id, rb.redemption.id);
        is(label, ra.redemption.code, rb.redemption.code);
        is(label, ra.coupon?.code ?? null, rb.coupon?.code ?? null);
        is(label, [ra.pointsSpent, rb.pointsSpent], [100, 100]);
        is(label, redemptions(w).length, 1);
        is(label, balance(w), 900);
        is(label, stock(w), 4);
        is(label, spendRows(w).length, 1);
        is(label, coupons(w).length, kind === 'VOUCHER' ? 1 : 0);
        consistent(w, label);
        waits += w.db.stats.lockWaits;
      }
      expect(waits).toBeGreaterThan(0);
    },
  );

  it('bỏ khoá dòng khách (tầng thứ hai): unique (userId, idempotencyKey) + bên thua huỷ giao dịch rồi phát lại; vẫn một lượt, tồn kho và điểm trừ đúng một lần', async () => {
    let waits = 0;
    let rollbacks = 0;
    for (const skew of SWEEP) {
      const w = createRedeemWorld({ userLock: false });
      seedUser(w, 'u1', 1000);
      seedGifts(w, voucherGiftRow('g1', { stock: 5 }));
      const label = `skew ${skew}`;

      const [a, b] = await raceBy(skew, () => w.loyalty.redeemReward('u1', 'g1', key(1)), () => w.loyalty.redeemReward('u1', 'g1', key(1)));

      is(label, ok(a).redemption.id, ok(b).redemption.id);
      is(label, ok(a).coupon?.code, ok(b).coupon?.code);
      is(label, redemptions(w).length, 1);
      is(label, balance(w), 900);
      is(label, stock(w), 4);
      consistent(w, label);
      waits += w.db.stats.lockWaits;
      rollbacks += w.db.stats.rollbacks;
    }
    expect(waits).toBeGreaterThan(0);
    // Ít nhất một mốc để bên thua đi hết transaction rồi mới ăn P2002 trên unique idempotencyKey: không có thì test này không chạm tầng thứ hai.
    expect(rollbacks).toBeGreaterThan(0);
  });

  it('cùng khoá, KHÁC quà, chạy đua (quét thời điểm): đúng một bên thành công, bên kia 409 tiếng Việt, không trừ điểm hay tồn kho của quà thua', async () => {
    const seen = new Set<string>();
    for (const skew of SWEEP) {
      const w = createRedeemWorld();
      seedUser(w, 'u1', 1000);
      seedGifts(w, giftRow('g1', { pointsCost: 100, stock: 5 }), giftRow('g2', { pointsCost: 200, stock: 5 }));
      const label = `skew ${skew}`;

      const [a, b] = await raceBy(skew, () => w.loyalty.redeemReward('u1', 'g1', key(1)), () => w.loyalty.redeemReward('u1', 'g2', key(1)));

      is(label, [a.status, b.status].filter((s) => s === 'fulfilled').length, 1);
      const loser = a.status === 'fulfilled' ? b : a;
      const winner = a.status === 'fulfilled' ? 'g1' : 'g2';
      is(label, loser.status, 'rejected');
      is(label, status(loser), 409);
      expect(failure(loser)).toBeInstanceOf(ConflictException);
      is(label, message(loser), 'Idempotency-Key này đã dùng cho một lượt đổi quà khác, hãy tạo khoá khác.');
      is(label, redemptions(w).map((r) => r.giftId), [winner]);
      is(label, balance(w), winner === 'g1' ? 900 : 800);
      is(label, stock(w, winner === 'g1' ? 'g2' : 'g1'), 5);
      consistent(w, label);
      seen.add(winner);
    }
    expect([...seen].sort()).toEqual(['g1', 'g2']);
  });

  it('gọi lại cùng khoá sau khi quà bị ẩn và hết tồn: vẫn nhận đúng kết quả cũ, không trừ thêm; khoá mới thì bị từ chối bằng tiếng Việt', async () => {
    const w = createRedeemWorld();
    seedUser(w, 'u1', 1000);
    seedUser(w, 'a1', 0, { role: 'ADMIN' });
    seedGifts(w, voucherGiftRow('g1', { stock: 1 }));
    const first = await w.loyalty.redeemReward('u1', 'g1', key(1));
    await w.admin.update('a1', 'g1', { status: 'HIDDEN' });

    const replay = await w.loyalty.redeemReward('u1', 'g1', key(1));
    await expect(w.loyalty.redeemReward('u1', 'g1', key(2))).rejects.toMatchObject({ message: SOLD_OUT });

    is('replay', [replay.redemption.id, replay.coupon?.code], [first.redemption.id, first.coupon?.code]);
    is('replay', replay.remainingPoints, 900);
    is('số lượt', redemptions(w).length, 1);
    is('số dư', balance(w), 900);
    is('tồn', stock(w), 0);
    consistent(w, 'sau replay');
  });
});

describe('Đổi Điểm Xanh lấy quà — tồn kho và số dư', () => {
  it('cùng một khách, 6 khoá khác nhau song song cho một quà còn 3 (nhiều khoảng cách giữa các lượt): đúng 3 lượt, 3 bên còn lại "đã hết", số dư và tồn khớp', async () => {
    let waits = 0;
    for (const gap of [0, 1, 2, 3, 5, 8]) {
      const w = createRedeemWorld();
      seedUser(w, 'u1', 400);
      seedGifts(w, voucherGiftRow('g1', { pointsCost: 100, stock: 3 }));
      const label = `gap ${gap}`;

      const results = await Promise.allSettled(
        Array.from({ length: 6 }, async (_, i) => (await delay(i * gap), w.loyalty.redeemReward('u1', 'g1', key(i)))),
      );

      const lost = results.filter((r) => r.status === 'rejected');
      is(label, results.filter((r) => r.status === 'fulfilled').length, 3);
      for (const r of lost) {
        is(label, status(r), 400);
        is(label, message(r), SOLD_OUT);
      }
      is(label, new Set(results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<any>).value.redemption.id)).size, 3);
      is(label, stock(w), 0);
      is(label, balance(w), 100);
      consistent(w, label);
      waits += w.db.stats.lockWaits;
    }
    expect(waits).toBeGreaterThan(0);
  });

  it('khách không bị giới hạn số lần đổi cùng một quà: hai khoá khác nhau đều được trừ điểm đủ tiền (quà không có hạn mức theo khách)', async () => {
    const w = createRedeemWorld();
    seedUser(w, 'u1', 1000);
    seedGifts(w, giftRow('g1', { pointsCost: 100, stock: null }));

    await w.loyalty.redeemReward('u1', 'g1', key(1));
    await w.loyalty.redeemReward('u1', 'g1', key(2));

    is('lượt đổi', redemptions(w).length, 2);
    is('số dư', balance(w), 800);
    consistent(w, 'hai lượt');
  });

  it('hai khách giành quà cuối (quét thời điểm): đúng một lượt, bên thua nhận "đã hết" và không mất điểm', async () => {
    const winners = new Set<string>();
    for (const skew of SWEEP) {
      const w = createRedeemWorld();
      seedUser(w, 'u1', 1000);
      seedUser(w, 'u2', 1000);
      seedGifts(w, giftRow('g1', { pointsCost: 100, stock: 1 }));
      const label = `skew ${skew}`;

      const [a, b] = await raceBy(skew, () => w.loyalty.redeemReward('u1', 'g1', key(1)), () => w.loyalty.redeemReward('u2', 'g1', key(2)));

      is(label, [a.status, b.status].filter((s) => s === 'fulfilled').length, 1);
      const loser = a.status === 'fulfilled' ? b : a;
      is(label, status(loser), 400);
      is(label, message(loser), SOLD_OUT);
      const winnerId = a.status === 'fulfilled' ? 'u1' : 'u2';
      is(label, balance(w, winnerId), 900);
      is(label, balance(w, winnerId === 'u1' ? 'u2' : 'u1'), 1000);
      is(label, stock(w), 0);
      consistent(w, label);
      winners.add(winnerId);
    }
    expect([...winners].sort()).toEqual(['u1', 'u2']);
  });

  it('hai quà khác nhau song song, số dư chỉ đủ một (quét thời điểm): đúng một lượt, số dư không âm, quà thua không mất tồn kho và không có mã mồ côi', async () => {
    const winners = new Set<string>();
    for (const skew of SWEEP) {
      const w = createRedeemWorld();
      seedUser(w, 'u1', 100);
      seedGifts(w, voucherGiftRow('g1', { pointsCost: 60, stock: 2 }), voucherGiftRow('g2', { pointsCost: 60, stock: 2 }));
      const label = `skew ${skew}`;

      const [a, b] = await raceBy(skew, () => w.loyalty.redeemReward('u1', 'g1', key(1)), () => w.loyalty.redeemReward('u1', 'g2', key(2)));

      is(label, [a.status, b.status].filter((s) => s === 'fulfilled').length, 1);
      const loser = a.status === 'fulfilled' ? b : a;
      is(label, status(loser), 400);
      is(label, message(loser), 'Bạn cần 60 Điểm Xanh để đổi ưu đãi này (hiện có 40 điểm).');
      const winner = a.status === 'fulfilled' ? 'g1' : 'g2';
      const lost = winner === 'g1' ? 'g2' : 'g1';
      is(label, balance(w), 40);
      is(label, stock(w, winner), 1);
      is(label, stock(w, lost), 2);
      is(label, coupons(w).length, 1);
      consistent(w, label);
      winners.add(winner);
    }
    expect([...winners].sort()).toEqual(['g1', 'g2']);
  });

  it('hai quà khác nhau song song, số dư đủ cả hai: cả hai thành công, mỗi quà trừ một lần', async () => {
    for (const skew of SWEEP) {
      const w = createRedeemWorld();
      seedUser(w, 'u1', 150);
      seedGifts(w, voucherGiftRow('g1', { pointsCost: 60, stock: 2 }), giftRow('g2', { pointsCost: 60, stock: 2 }));
      w.db.seed('wastePoint', [warehouseRow]);
      const label = `skew ${skew}`;

      const [a, b] = await raceBy(skew, () => w.loyalty.redeemReward('u1', 'g1', key(1)), () => w.loyalty.redeemReward('u1', 'g2', key(2)));

      ok(a);
      ok(b);
      is(label, balance(w), 30);
      is(label, [stock(w, 'g1'), stock(w, 'g2')], [1, 1]);
      consistent(w, label);
    }
  });

  it('số dư đúng bằng giá: 5 quà cùng giá, 5 khoá song song (nhiều khoảng cách) → một lượt, số dư về 0 không âm', async () => {
    for (const gap of [0, 1, 2, 4]) {
      const w = createRedeemWorld();
      seedUser(w, 'u1', 100);
      seedGifts(w, ...Array.from({ length: 5 }, (_, i) => giftRow(`g${i}`, { pointsCost: 100, stock: null })));
      const label = `gap ${gap}`;

      const results = await Promise.allSettled(Array.from({ length: 5 }, async (_, i) => (await delay(i * gap), w.loyalty.redeemReward('u1', `g${i}`, key(i)))));

      is(label, results.filter((r) => r.status === 'fulfilled').length, 1);
      for (const r of results.filter((x) => x.status === 'rejected')) is(label, message(r), 'Bạn cần 100 Điểm Xanh để đổi ưu đãi này (hiện có 0 điểm).');
      is(label, balance(w), 0);
      consistent(w, label);
    }
  });

  it('mã giảm giá trùng (hiếm): giao dịch đầu bị huỷ vì P2002 trên mã, thử lại với mã mới; trừ điểm và tồn kho đúng một lần', async () => {
    const nodeCrypto = jest.requireActual<typeof import('node:crypto')>('node:crypto');
    const zeros = () => Buffer.alloc(8);
    const w = createRedeemWorld();
    seedUser(w, 'u1', 1000);
    seedUser(w, 'u2', 1000);
    seedGifts(w, voucherGiftRow('g1', { pointsCost: 100, stock: 5 }));
    const spy = jest.spyOn(nodeCrypto, 'randomBytes').mockImplementationOnce(zeros);
    await w.loyalty.redeemReward('u1', 'g1', key(1));
    const takenCode = coupons(w)[0]!.code as string;
    spy.mockImplementationOnce(zeros);
    const rollbacksBefore = w.db.stats.rollbacks;

    const second = await w.loyalty.redeemReward('u2', 'g1', key(2));

    expect(w.db.stats.rollbacks).toBeGreaterThan(rollbacksBefore);
    expect(second.coupon?.code).not.toBe(takenCode);
    is('mã', coupons(w).map((c) => c.code).sort(), [takenCode, second.coupon!.code].sort());
    is('số dư u2', balance(w, 'u2'), 900);
    is('tồn', stock(w), 3);
    consistent(w, 'sau thử lại');
  });
});

describe('Đổi Điểm Xanh lấy quà — chen với việc ghi điểm của luồng khác', () => {
  const pending = (userId: string, id: string, earned: number) => ({
    id,
    code: `TT-${id}`,
    userId,
    status: 'DELIVERED',
    pointsEarned: earned,
    pointsUsed: 0,
    pointsUsedConverted: 0,
    deliveredAt: new Date(Date.now() - 86_400_000),
  });

  it('điểm đơn vừa giao chen vào lúc đổi: phần điểm đang khoá không đổi được (quét rộng); đã cộng thì khoá tới khi hết cửa sổ đổi/trả', async () => {
    let waits = 0;
    for (const skew of WIDE_SWEEP) {
      const w = createRedeemWorld();
      seedUser(w, 'u1', 100);
      seedGifts(w, giftRow('g1', { pointsCost: 120, stock: null }));
      w.db.seed('order', [pending('u1', 'O1', 50)]);
      const label = `skew ${skew}`;

      const [credit, redeem] = await raceBy(skew, () => w.loyalty.creditOrderPoints('O1'), () => w.loyalty.redeemReward('u1', 'g1', key(1)));

      is(label, ok(credit), true);
      is(label, status(redeem), 400);
      expect(message(redeem)).toMatch(/^Bạn cần 120 Điểm Xanh/);
      is(label, balance(w), 150);
      is(label, redemptions(w).length, 0);
      is(label, ledger(w).filter((t) => t.reason === 'ORDER_DELIVERED:TT-O1').length, 1);
      consistent(w, label);
      waits += w.db.stats.lockWaits;
    }
    expect(waits).toBeGreaterThan(0);
  });

  it('điểm đơn vừa giao chen vào, quà vừa túi điểm dùng được: luôn đổi được, dù đơn commit trước hay sau (không bị chặn oan vì khoá cũ)', async () => {
    for (const skew of WIDE_SWEEP) {
      const w = createRedeemWorld();
      seedUser(w, 'u1', 100);
      seedGifts(w, giftRow('g1', { pointsCost: 80, stock: null }));
      w.db.seed('order', [pending('u1', 'O1', 50)]);
      const label = `skew ${skew}`;

      const [credit, redeem] = await raceBy(skew, () => w.loyalty.creditOrderPoints('O1'), () => w.loyalty.redeemReward('u1', 'g1', key(1)));

      is(label, ok(credit), true);
      is(label, ok(redeem).pointsSpent, 80);
      is(label, balance(w), 70);
      consistent(w, label);
    }
  });

  it.each([
    { price: 40, expectOk: true, final: 0 },
    { price: 50, expectOk: false, final: 40 },
  ])('đơn bị trả chen vào lúc đổi, quà giá $price (điểm dùng được 40, đơn khoá 60): điểm đơn luôn thu hồi đủ 60, số dư không âm (quét rộng)', async ({ price, expectOk, final }) => {
    for (const skew of WIDE_SWEEP) {
      const w = createRedeemWorld();
      const o = deliveredOrder('O1', 'u1', 60, 'RETURNED');
      seedUser(w, 'u1', [lotRow('L0', 'u1', 40, 30, 300), o.ledger]);
      seedGifts(w, giftRow('g1', { pointsCost: price, stock: null }));
      w.db.seed('order', [o.order]);
      const label = `skew ${skew}`;

      const [reverse, redeem] = await raceBy(skew, () => w.loyalty.reverseOrderPoints('O1'), () => w.loyalty.redeemReward('u1', 'g1', key(1)));

      is(label, reverse.status, 'fulfilled');
      is(label, redeem.status, expectOk ? 'fulfilled' : 'rejected');
      if (!expectOk) expect(message(redeem)).toMatch(/^Bạn cần 50 Điểm Xanh/);
      const reversed = ledger(w).filter((t) => t.reason === 'ORDER_REVERSED:TT-O1');
      is(label, reversed.map((t) => t.delta), [-60]);
      is(label, balance(w), final);
      consistent(w, label);
    }
  });

  it('điểm hết hạn chen vào lúc đổi (quà 120, lô hết hạn 100 + lô còn hạn 50; quét rộng): hoặc đổi trước và cron không trừ gì, hoặc cron trừ trước và đổi bị từ chối', async () => {
    const outcomes = new Set<string>();
    for (const skew of WIDE_SWEEP) {
      const w = createRedeemWorld();
      seedUser(w, 'u1', [lotRow('A', 'u1', 100, 400, -1), lotRow('B', 'u1', 50, 10, 300)]);
      seedGifts(w, giftRow('g1', { pointsCost: 120, stock: null }));
      const label = `skew ${skew}`;

      const [expire, redeem] = await raceBy(skew, () => w.expire('u1'), () => w.loyalty.redeemReward('u1', 'g1', key(1)));

      const expiredRows = ledger(w).filter((t) => t.reason === 'POINTS_EXPIRED');
      if (redeem.status === 'fulfilled') {
        is(label, [ok(expire), expiredRows.length, balance(w)], [0, 0, 30]);
        outcomes.add('đổi trước');
      } else {
        is(label, message(redeem), 'Bạn cần 120 Điểm Xanh để đổi ưu đãi này (hiện có 50 điểm).');
        is(label, [ok(expire), expiredRows.map((t) => t.delta), balance(w)], [100, [-100], 50]);
        outcomes.add('hết hạn trước');
      }
      consistent(w, label);
    }
    expect([...outcomes].sort()).toEqual(['hết hạn trước', 'đổi trước']);
  });

  it('điểm hết hạn chen vào, quà giá 40 đổi được ở cả hai thứ tự: số dư cuối khớp thứ tự ghi trong sổ (hết hạn trước: 10, đổi trước: 50), không trừ trùng', async () => {
    const seen = new Set<number>();
    for (const skew of WIDE_SWEEP) {
      const w = createRedeemWorld();
      seedUser(w, 'u1', [lotRow('A', 'u1', 100, 400, -1), lotRow('B', 'u1', 50, 10, 300)]);
      seedGifts(w, giftRow('g1', { pointsCost: 40, stock: null }));
      const label = `skew ${skew}`;

      const [expire, redeem] = await raceBy(skew, () => w.expire('u1'), () => w.loyalty.redeemReward('u1', 'g1', key(1)));

      ok(redeem);
      const expiredRow = ledger(w).find((t) => t.reason === 'POINTS_EXPIRED');
      const spendRow = spendRows(w)[0]!;
      const expireFirst = expiredRow !== undefined && expiredRow.createdAt.getTime() < spendRow.createdAt.getTime();
      is(label, [ok(expire), balance(w)], expireFirst ? [100, 10] : [60, 50]);
      consistent(w, label);
      seen.add(balance(w));
    }
    expect([...seen].sort((x, y) => x - y)).toEqual([10, 50]);
  });
});

describe('Đổi Điểm Xanh lấy quà — điểm đang khoá của đơn', () => {
  it('đơn giao quá cửa sổ đổi/trả (10 ngày, cửa sổ 7) thì điểm dùng được; cấu hình cửa sổ 14 ngày thì vẫn khoá', async () => {
    for (const [windowDays, expectOk] of [[7, true], [14, false]] as const) {
      const w = createRedeemWorld({ config: { 'returns.window_days': windowDays } });
      const o = deliveredOrder('O1', 'u1', 50, 'DELIVERED', 10);
      seedUser(w, 'u1', [lotRow('L0', 'u1', 100, 30, 300), o.ledger]);
      seedGifts(w, giftRow('g1', { pointsCost: 150, stock: null }));
      w.db.seed('order', [o.order]);

      const [r] = await Promise.allSettled([w.loyalty.redeemReward('u1', 'g1', key(1))]);

      is(`cửa sổ ${windowDays} ngày`, r!.status, expectOk ? 'fulfilled' : 'rejected');
      is(`cửa sổ ${windowDays} ngày`, balance(w), expectOk ? 0 : 150);
      consistent(w, `cửa sổ ${windowDays}`);
    }
  });

  it('đơn đã quá cửa sổ nhưng còn yêu cầu trả đang chờ duyệt thì điểm vẫn khoá, câu báo nêu đúng lý do', async () => {
    const w = createRedeemWorld();
    const o = deliveredOrder('O1', 'u1', 60, 'DELIVERED', 10);
    seedUser(w, 'u1', [lotRow('L0', 'u1', 100, 30, 300), o.ledger]);
    seedGifts(w, giftRow('g1', { pointsCost: 101, stock: null }));
    w.db.seed('order', [o.order]);
    w.db.seed('returnRequest', [{ id: 'rr1', orderId: 'O1', status: 'REQUESTED', fullReturn: false, pointsReversed: 0 }]);

    const [r] = await Promise.allSettled([w.loyalty.redeemReward('u1', 'g1', key(1))]);

    is('mã', status(r!), 400);
    expect(message(r!)).toBe(
      'Bạn cần 101 Điểm Xanh dùng được để đổi ưu đãi này — hiện dùng được 100/160 điểm: 60 điểm từ đơn đang chờ xử lý đổi/trả sẽ dùng được khi yêu cầu được xử lý xong.',
    );
    is('không trừ', [balance(w), redemptions(w).length], [160, 0]);
  });

  it('đã duyệt trả một phần thì chỉ còn khoá phần điểm chưa bị thu hồi (đơn +60, đã thu hồi 20, khoá 40)', async () => {
    const w = createRedeemWorld();
    const o = deliveredOrder('O1', 'u1', 60, 'DELIVERED', 1);
    const reversed = lotRow('rev1', 'u1', -20, 0.5, null, { reason: 'RETURN_REVERSED:TT-O1', refType: 'RETURN_REQUEST', refId: 'rr1' });
    seedUser(w, 'u1', [lotRow('L0', 'u1', 100, 30, 300), o.ledger, reversed]);
    seedGifts(w, giftRow('fit', { pointsCost: 100, stock: null }), giftRow('over', { pointsCost: 101, stock: null }));
    w.db.seed('order', [o.order]);
    w.db.seed('returnRequest', [{ id: 'rr1', orderId: 'O1', status: 'APPROVED', fullReturn: false, pointsReversed: 20 }]);

    const [over, fit] = await Promise.allSettled([w.loyalty.redeemReward('u1', 'over', key(1)), w.loyalty.redeemReward('u1', 'fit', key(2))]);

    is('đổi được', [over.status, fit.status], ['rejected', 'fulfilled']);
    is('số dư', balance(w), 40);
    consistent(w, 'trả một phần');
  });
});

describe('Đổi Điểm Xanh lấy quà — chen với admin sửa quà', () => {
  it.each(['GIFT', 'VOUCHER'] as const)(
    'admin tắt quà %s lúc có người đổi (quét thời điểm): hoặc đổi trước khi tắt, hoặc bị từ chối không trừ điểm; không có trạng thái nửa vời',
    async (kind) => {
      const outcomes = new Set<string>();
      for (const skew of SWEEP) {
        const w = createRedeemWorld();
        seedUser(w, 'u1', 1000);
        seedUser(w, 'a1', 0, { role: 'ADMIN' });
        seedGifts(w, kind === 'VOUCHER' ? voucherGiftRow('g1', { stock: 3 }) : giftRow('g1', { stock: 3 }));
        w.db.seed('wastePoint', [warehouseRow]);
        const label = `skew ${skew}`;

        const [hide, redeem] = await raceBy(skew, () => w.admin.update('a1', 'g1', { status: 'HIDDEN' }), () => w.loyalty.redeemReward('u1', 'g1', key(1)));

        ok(hide);
        is(label, w.db.row('wasteGift', 'g1')!.status, 'HIDDEN');
        is(label, events(w, 'GIFT_UPDATED').length, 1);
        if (redeem.status === 'fulfilled') {
          is(label, [balance(w), stock(w), redemptions(w).length], [900, 2, 1]);
          outcomes.add('đổi trước khi tắt');
        } else {
          is(label, [status(redeem), message(redeem)], [400, SOLD_OUT]);
          is(label, [balance(w), stock(w), redemptions(w).length, coupons(w).length], [1000, 3, 0, 0]);
          outcomes.add('bị từ chối');
        }
        consistent(w, label);
      }
      expect([...outcomes].sort()).toEqual(['bị từ chối', 'đổi trước khi tắt']);
    },
  );

  it('admin đặt tồn về 0 lúc có người đổi quà cuối (quét thời điểm): không bao giờ có lượt đổi mà tồn kho âm, bên bị từ chối không mất điểm', async () => {
    for (const skew of SWEEP) {
      const w = createRedeemWorld();
      seedUser(w, 'u1', 1000);
      seedUser(w, 'a1', 0, { role: 'ADMIN' });
      seedGifts(w, giftRow('g1', { stock: 1 }));
      w.db.seed('wastePoint', [warehouseRow]);
      const label = `skew ${skew}`;

      const [set, redeem] = await raceBy(skew, () => w.admin.update('a1', 'g1', { stock: 0 }), () => w.loyalty.redeemReward('u1', 'g1', key(1)));

      ok(set);
      is(label, stock(w), 0);
      is(label, balance(w), redeem.status === 'fulfilled' ? 900 : 1000);
      consistent(w, label);
    }
  });

  it('admin đổi giá quà lúc có người đổi (quét thời điểm): lượt đổi nhất quán theo MỘT bản giá (điểm trừ = giá ghi trên lượt đổi = dòng sổ = pointsSpent); giá lấy từ bản đọc trước giao dịch nên có thể là giá cũ', async () => {
    const charged = new Set<number>();
    for (const skew of WIDE_SWEEP) {
      const w = createRedeemWorld();
      seedUser(w, 'u1', 1000);
      seedUser(w, 'a1', 0, { role: 'ADMIN' });
      seedGifts(w, giftRow('g1', { pointsCost: 100, stock: null }));
      w.db.seed('wastePoint', [warehouseRow]);
      const label = `skew ${skew}`;

      const [change, redeem] = await raceBy(skew, () => w.admin.update('a1', 'g1', { pointsCost: 500 }), () => w.loyalty.redeemReward('u1', 'g1', key(1)));

      ok(change);
      const result = ok(redeem);
      is(label, [result.pointsSpent, result.redemption.pointsCost, 1000 - balance(w), -spendRows(w)[0]!.delta], Array(4).fill(result.pointsSpent));
      expect([100, 500]).toContain(result.pointsSpent);
      consistent(w, label);
      charged.add(result.pointsSpent);
    }
    expect([...charged].sort((x, y) => x - y)).toEqual([100, 500]);
  });
});

describe('Đổi Điểm Xanh lấy quà — thông báo từ chối bằng tiếng Việt', () => {
  it('mọi lý do từ chối đều là HttpException với câu tiếng Việt có dấu, không lộ chuỗi tiếng Anh hay mã lỗi', async () => {
    const w = createRedeemWorld();
    seedUser(w, 'u1', 1000);
    seedUser(w, 'guest1', 1000, { phone: null, zaloId: 'guest_guest1' });
    seedGifts(
      w,
      giftRow('plain', { pointsCost: 100, stock: null }),
      giftRow('tree', { kind: 'TREE', pointsCost: 100 }),
      giftRow('hidden', { status: 'HIDDEN' }),
      giftRow('empty', { stock: 0 }),
      giftRow('pricey', { pointsCost: 5000 }),
      giftRow('seed', { kind: 'SEED_PACK', pointsCost: 100, stock: 3 }),
    );
    await w.loyalty.redeemReward('u1', 'plain', key('conflict'));
    const ctrl = new LoyaltyController({ redeemReward: jest.fn() } as unknown as LoyaltyService);

    const cases: { name: string; run: () => Promise<unknown> | unknown; code: number; text: string | RegExp }[] = [
      { name: 'quà không tồn tại', run: () => w.loyalty.redeemReward('u1', 'nope', key(1)), code: 404, text: 'Phần thưởng "nope" không tồn tại.' },
      { name: 'quà góp cây', run: () => w.loyalty.redeemReward('u1', 'tree', key(2)), code: 400, text: 'Quà góp quỹ trồng cây đổi bằng nút Góp cây ở Vườn Xanh.' },
      { name: 'quà đã tắt', run: () => w.loyalty.redeemReward('u1', 'hidden', key(3)), code: 400, text: SOLD_OUT },
      { name: 'quà hết tồn', run: () => w.loyalty.redeemReward('u1', 'empty', key(4)), code: 400, text: SOLD_OUT },
      { name: 'thiếu điểm', run: () => w.loyalty.redeemReward('u1', 'pricey', key(5)), code: 400, text: 'Bạn cần 5.000 Điểm Xanh để đổi ưu đãi này (hiện có 900 điểm).' },
      { name: 'khách vãng lai đổi quà vật lý', run: () => w.loyalty.redeemReward('guest1', 'seed', key(6)), code: 403, text: /^Ưu đãi này chỉ dành cho tài khoản đã đăng nhập Zalo/ },
      { name: 'khoá đã dùng cho quà khác', run: () => w.loyalty.redeemReward('u1', 'seed', key('conflict')), code: 409, text: 'Idempotency-Key này đã dùng cho một lượt đổi quà khác, hãy tạo khoá khác.' },
      { name: 'thiếu Idempotency-Key', run: () => ctrl.redeemReward('u1', 'plain', undefined), code: 400, text: /^Thiếu Idempotency-Key: cần 8 đến 128 ký tự/ },
    ];
    for (const c of cases) {
      const settled = await Promise.allSettled([Promise.resolve().then(c.run)]);
      is(c.name, [status(settled[0]!), settled[0]!.status], [c.code, 'rejected']);
      const text = message(settled[0]!);
      if (typeof c.text === 'string') is(c.name, text, c.text);
      else expect({ name: c.name, text }).toEqual({ name: c.name, text: expect.stringMatching(c.text) });
      expect({ name: c.name, vietnamese: HAS_VIETNAMESE.test(text) }).toEqual({ name: c.name, vietnamese: true });
      expect({ name: c.name, text }).not.toEqual({ name: c.name, text: expect.stringMatching(/Unique constraint|P2002|Internal server error|Bad Request|Not Found|Forbidden|Conflict/) });
    }
    is('không ghi gì khi bị từ chối', [redemptions(w).length, balance(w, 'guest1'), stock(w, 'seed'), stock(w, 'empty')], [1, 1000, 3, 0]);
    consistent(w, 'sau các lần từ chối');
  });

  it('điểm bị khoá: câu giải thích nói rõ bao nhiêu điểm dùng được và vì sao (đơn mới giao), cùng luật với danh mục', async () => {
    const w = createRedeemWorld();
    const o = deliveredOrder('O1', 'u1', 50, 'DELIVERED', 1);
    seedUser(w, 'u1', [lotRow('L0', 'u1', 100, 30, 300), o.ledger]);
    seedGifts(w, giftRow('g1', { pointsCost: 101, stock: null }));
    w.db.seed('order', [o.order]);

    const [r] = await Promise.allSettled([w.loyalty.redeemReward('u1', 'g1', key(1))]);

    is('mã', status(r!), 400);
    expect(message(r!)).toMatch(/^Bạn cần 101 Điểm Xanh dùng được để đổi ưu đãi này — hiện dùng được 100\/150 điểm: 50 điểm từ đơn mới giao sẽ dùng được sau ngày \d{2}\/\d{2}\/\d{4} \(hết hạn đổi\/trả hàng\)\.$/);
    is('không trừ', [balance(w), redemptions(w).length], [150, 0]);
  });

  it('danh mục: canRedeem đúng bằng việc đổi có được hay không ở ranh giới điểm dùng được (số dư 150, khoá 50)', async () => {
    const w = createRedeemWorld();
    const o = deliveredOrder('O1', 'u1', 50, 'DELIVERED', 1);
    seedUser(w, 'u1', [lotRow('L0', 'u1', 100, 30, 300), o.ledger]);
    seedGifts(w, giftRow('fit', { pointsCost: 100, stock: null, sortOrder: 1 }), giftRow('over', { pointsCost: 101, stock: null, sortOrder: 2 }), giftRow('gone', { pointsCost: 10, stock: 0, sortOrder: 3 }));
    w.db.seed('order', [o.order]);

    const catalog = await w.loyalty.getRewardCatalog('u1');

    is('danh mục', catalog.rewards.map((r) => [r.id, r.canRedeem, r.soldOut]), [['fit', true, false], ['over', false, false], ['gone', false, true]]);
    is('số liệu', [catalog.pointsBalance, catalog.lockedPoints, catalog.redeemablePoints], [150, 50, 100]);
    const [fit, over] = await Promise.allSettled([w.loyalty.redeemReward('u1', 'fit', key(1)), w.loyalty.redeemReward('u1', 'over', key(2))]);
    is('đổi được', [fit.status, over.status], ['fulfilled', 'rejected']);
    const after = await w.loyalty.getRewardCatalog('u1');
    is('sau khi đổi', [after.pointsBalance, after.redeemablePoints, after.rewards.find((r) => r.id === 'fit')?.canRedeem], [50, 0, false]);
  });
});

