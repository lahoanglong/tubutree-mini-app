import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { RaceDb, tick } from '../../../test/fakes/race-db.fake';
import { AdminCouponBatchService } from '../admin/admin-coupon-batch.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { CouponClaimService } from './coupon-claim.service';
import { CouponsService } from './coupons.service';

/**
 * Nhận mã giảm giá chạy đồng thời (Postgres READ COMMITTED, xem test/fakes/race-db.fake.ts): cùng một khách nhận một mã hai lần,
 * nhiều khách tranh lượt cuối của mã có tổng lượt, nhận chen với admin tắt lô / đổi hạn / đổi tổng lượt, gõ mã thẻ ở giỏ chen với
 * quét QR và với đặt đơn, hai lần "Tạo lô" cùng tiền tố. Mỗi mã chỉ có tối đa `usageLimit` dòng coupon_claims, mỗi khách tối đa một dòng,
 * bên thua nhận lỗi 400 tiếng Việt nói đúng lý do, không bao giờ lỗi 500 hay dòng thứ hai.
 * Dùng service THẬT; chỉ khoá advisory được giả bằng handler (khoá chỉ có khi chuỗi SQL còn chứa pg_advisory_xact_lock).
 */
const delay = async (n: number) => {
  for (let i = 0; i < n; i++) await tick();
};
const later = <T>(n: number, fn: () => Promise<T>) => delay(n).then(fn);
const SKEWS = Array.from({ length: 81 }, (_, i) => i - 40);
const pair = <A, B>(skew: number, a: () => Promise<A>, b: () => Promise<B>) =>
  Promise.allSettled([later(Math.max(0, skew), a), later(Math.max(0, -skew), b)] as const) as Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]>;

const VI = /[ạảãàáâậầấẩẫăắằặẳẵéèẻẽẹêếềệểễóòỏõọôộổỗồốơớờợởỡúùủũụưựứừửữíìỉĩịýỳỷỹỵđ]/i;
const is = (label: string, actual: unknown, expected: unknown) => expect({ label, actual }).toEqual({ label, actual: expected });

const LIMIT_ONE = 'Mã giảm giá này đã được tài khoản khác nhận.';
const LIMIT_MANY = 'Mã giảm giá đã hết lượt nhận.';
const INACTIVE = 'Mã giảm giá đã ngừng áp dụng.';
const EXPIRED = 'Mã giảm giá đã hết hạn.';

const CODE = 'SHOPEE-AB12CD34';
const past = () => new Date(Date.now() - 864e5);
const future = () => new Date(Date.now() + 864e5);

function setup(opts: { coupon?: Record<string, unknown>; users?: number; claimedBy?: string[]; orders?: Record<string, unknown>[] } = {}) {
  const db = new RaceDb({
    coupon: { unique: [{ fields: ['code'] }], defaults: { usedCount: 0, perUserLimit: 1, isActive: true, newCustomerOnly: false, batch: null, createdById: null } },
    couponClaim: { unique: [{ fields: ['couponId', 'userId'] }] },
    couponRedemption: { unique: [{ fields: ['couponId', 'orderId'] }] },
    user: {},
    order: {},
  });
  db.seed(
    'user',
    Array.from({ length: opts.users ?? 6 }, (_, i) => ({ id: `u${i + 1}`, tierId: null, phone: `09120000${i + 1}`, zaloId: `z${i + 1}`, role: 'CUSTOMER' })),
  );
  db.seed('coupon', [
    {
      id: 'c1',
      code: CODE,
      type: 'AMOUNT',
      value: 30000,
      minOrder: null,
      maxDiscount: null,
      startAt: past(),
      endAt: future(),
      usageLimit: 1,
      usedCount: 0,
      perUserLimit: 1,
      isActive: true,
      scope: 'CLAIM',
      scopeMeta: null,
      newCustomerOnly: false,
      batch: null,
      createdById: null,
      ...opts.coupon,
    },
  ]);
  db.seed('couponClaim', (opts.claimedBy ?? []).map((userId) => ({ couponId: 'c1', userId })));
  db.seed('order', opts.orders ?? []);
  db.handlers.push({ match: /pg_advisory_xact_lock\(/, run: (c) => c.lockKey(c.params.map(String).join('|')).then(() => 1) });
  let insertAttempts = 0;
  const realTransaction = db.client.$transaction;
  db.client.$transaction = (cb: (tx: any) => Promise<unknown>) =>
    realTransaction((tx: any) => {
      const createMany = tx.couponClaim.createMany;
      tx.couponClaim.createMany = (args: unknown) => {
        insertAttempts += 1;
        return createMany(args);
      };
      return cb(tx);
    });
  const claims = new CouponClaimService(db.client);
  const coupons = new CouponsService(db.client);
  const owners = () => db.rows('couponClaim').map((r) => r.userId as string).sort();
  return { db, claims, coupons, owners, insertAttempts: () => insertAttempts };
}

function expectRefused(r: PromiseSettledResult<unknown>, message: string) {
  is('bên thua bị từ chối', r.status, 'rejected');
  const reason = (r as PromiseRejectedResult).reason as Error;
  expect(reason).toBeInstanceOf(BadRequestException);
  is('lý do', reason.message, message);
  expect(reason.message).toMatch(VI);
}

const fulfilled = (rs: PromiseSettledResult<unknown>[]) => rs.filter((r) => r.status === 'fulfilled').length;
const flags = (rs: PromiseSettledResult<{ alreadyClaimed: boolean }>[]) =>
  rs.flatMap((r) => (r.status === 'fulfilled' ? [r.value.alreadyClaimed] : [])).sort();

describe('CouponClaimService.claim — race', () => {
  it.each([[1], [500], [null]])('cùng một khách nhận cùng mã hai lần song song (tổng lượt %p): đúng MỘT dòng, hai lần đều thành công, chỉ một lần là lần đầu', async (usageLimit) => {
    let collided = 0;
    for (const skew of SKEWS) {
      const { db, claims, owners, insertAttempts } = setup({ coupon: { usageLimit } });
      const rs = await pair(skew, () => claims.claim('u1', CODE), () => claims.claim('u1', CODE));
      is(`skew ${skew}: cả hai thành công`, fulfilled(rs), 2);
      is(`skew ${skew}: một dòng`, owners(), ['u1']);
      is(`skew ${skew}: đúng một lần là lần đầu`, flags(rs), [false, true]);
      // Có tổng lượt: `lockWaits` đếm cả lần chờ khoá advisory lẫn lần chờ khoá unique của INSERT trùng. Không có tổng lượt: cả hai cùng INSERT và ON CONFLICT DO NOTHING nuốt lần sau.
      collided += usageLimit === null ? insertAttempts() - 1 : db.stats.lockWaits;
    }
    expect(collided).toBeGreaterThan(0);
  });

  it.each([
    ['mã chung còn một lượt (4/5)', { usageLimit: 5 }, ['p1', 'p2', 'p3', 'p4'], LIMIT_MANY, 5],
    ['mã thẻ riêng một lượt', { usageLimit: 1 }, [], LIMIT_ONE, 1],
  ])('hai khách tranh lượt cuối của %s: chỉ một bên thắng, bên thua nhận lý do hết lượt', async (_name, coupon, taken, message, total) => {
    let collided = 0;
    for (const skew of SKEWS) {
      const { db, claims, owners } = setup({ coupon, claimedBy: taken });
      const rs = await pair(skew, () => claims.claim('u1', CODE), () => claims.claim('u2', CODE));
      is(`skew ${skew}: một bên thắng`, fulfilled(rs), 1);
      expectRefused(rs.find((r) => r.status === 'rejected')!, message);
      is(`skew ${skew}: số dòng đúng bằng tổng lượt`, owners().length, total);
      collided += db.stats.lockWaits;
    }
    expect(collided).toBeGreaterThan(0);
  });

  it('sáu khách tranh ba lượt: đúng ba dòng, đúng ba khách thắng, ba khách thua nhận lý do hết lượt', async () => {
    for (const step of [0, 1, 2, 3, 5, 8]) {
      for (const reversed of [false, true]) {
        const { claims, owners } = setup({ coupon: { usageLimit: 3 } });
        const ids = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
        const order = reversed ? [...ids].reverse() : ids;
        const rs = await Promise.allSettled(order.map((id, i) => later(i * step, () => claims.claim(id, CODE))));
        is(`bước ${step}${reversed ? ' ngược' : ''}: ba bên thắng`, fulfilled(rs), 3);
        const winners = order.filter((_, i) => rs[i]!.status === 'fulfilled').sort();
        is('chủ các dòng là người thắng', owners(), winners);
        rs.filter((r) => r.status === 'rejected').forEach((r) => expectRefused(r, LIMIT_MANY));
      }
    }
  });

  it('một khách bấm hai lần chen với khách thứ hai trên thẻ riêng: một dòng, mọi lần gọi của chủ dòng đều thành công, mọi lần của người kia bị từ chối', async () => {
    for (let second = 0; second <= 12; second++) {
      for (let other = 0; other <= 12; other++) {
        const { claims, owners } = setup({ coupon: { usageLimit: 1 } });
        const rs = await Promise.allSettled([
          claims.claim('u1', CODE),
          later(second, () => claims.claim('u1', CODE)),
          later(other, () => claims.claim('u2', CODE)),
        ]);
        const rows = owners();
        is(`(${second},${other}): một dòng`, rows.length, 1);
        const owner = rows[0]!;
        const mine = owner === 'u1' ? [rs[0]!, rs[1]!] : [rs[2]!];
        const theirs = owner === 'u1' ? [rs[2]!] : [rs[0]!, rs[1]!];
        is(`(${second},${other}): chủ dòng thành công`, mine.every((r) => r.status === 'fulfilled'), true);
        theirs.forEach((r) => expectRefused(r, LIMIT_ONE));
      }
    }
  });

  it('lượt nhận của mã khác không tính vào tổng lượt của mã này', async () => {
    const { db, claims, owners } = setup({ coupon: { usageLimit: 1 } });
    db.seed('coupon', [{ id: 'c2', code: 'OTHER-AAAA1111', type: 'AMOUNT', value: 1, startAt: past(), endAt: future(), usageLimit: 1, usedCount: 0, perUserLimit: 1, isActive: true, scope: 'CLAIM', newCustomerOnly: false, batch: null, createdById: null }]);
    db.seed('couponClaim', [{ couponId: 'c2', userId: 'u2' }, { couponId: 'c2', userId: 'u3' }]);
    await expect(claims.claim('u1', CODE)).resolves.toMatchObject({ alreadyClaimed: false });
    is('chỉ dòng của mã này tính', owners().filter((u) => u === 'u1'), ['u1']);
    is('tổng số dòng', db.rows('couponClaim').length, 3);
  });

  it('mã không giới hạn tổng lượt: bốn khách nhận cùng lúc đều được, mỗi người một dòng', async () => {
    const { claims, owners } = setup({ coupon: { usageLimit: null } });
    const rs = await Promise.allSettled(['u1', 'u2', 'u3', 'u4'].map((id, i) => later(i, () => claims.claim(id, CODE))));
    is('cả bốn thành công', fulfilled(rs), 4);
    is('bốn dòng', owners(), ['u1', 'u2', 'u3', 'u4']);
  });

  it('khách đã nhận rồi quét lại lúc mã vừa hết lượt vì người khác: vẫn được báo đã có trong ví, không mất dòng', async () => {
    for (const skew of SKEWS) {
      const { claims, owners } = setup({ coupon: { usageLimit: 2 }, claimedBy: ['u1'] });
      const rs = await pair(skew, () => claims.claim('u1', CODE), () => claims.claim('u2', CODE));
      is(`skew ${skew}: cả hai thành công`, fulfilled(rs), 2);
      is('hai dòng', owners(), ['u1', 'u2']);
      const again = rs[0] as PromiseFulfilledResult<{ alreadyClaimed: boolean }>;
      is('khách cũ nhận lại là "đã có"', again.value.alreadyClaimed, true);
    }
  });

  it('thẻ chỉ dành khách mới: khách cũ không giữ chỗ của thẻ, khách mới nhận được dù tranh nhau với khách cũ', async () => {
    for (const skew of SKEWS) {
      const { claims, owners } = setup({
        coupon: { usageLimit: 1, newCustomerOnly: true },
        orders: [{ id: 'o-old', userId: 'u1', status: 'DELIVERED' }],
      });
      const rs = await pair(skew, () => claims.claim('u1', CODE), () => claims.claim('u2', CODE));
      expectRefused(rs[0], 'Mã này chỉ dành cho khách đặt đơn đầu tiên tại Tubu Tree.');
      is(`skew ${skew}: khách mới thắng`, rs[1].status, 'fulfilled');
      is('chủ dòng', owners(), ['u2']);
    }
  });

  it('khách đặt đơn đầu chen vào lúc nhận thẻ chỉ-khách-mới: hoặc nhận được hoặc bị từ chối bằng câu tiếng Việt, không có kết quả nửa vời', async () => {
    const seen = new Set<string>();
    for (const skew of SKEWS) {
      const { db, claims, owners } = setup({ coupon: { usageLimit: 1, newCustomerOnly: true } });
      const [claim] = await pair(
        skew,
        () => claims.claim('u1', CODE),
        () => db.client.order.create({ data: { userId: 'u1', status: 'PENDING' } }),
      );
      if (claim.status === 'fulfilled') {
        is('nhận được thì có dòng', owners(), ['u1']);
        seen.add('nhận');
      } else {
        expectRefused(claim, 'Mã này chỉ dành cho khách đặt đơn đầu tiên tại Tubu Tree.');
        is('bị từ chối thì không giữ chỗ', owners(), []);
        seen.add('từ chối');
      }
    }
    is('cả hai thứ tự đều xảy ra trong lưới skew', [...seen].sort(), ['nhận', 'từ chối']);
  });
});

describe('CouponClaimService.claim — chen với admin đổi mã', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  function batchService(db: RaceDb) {
    const config = { get: jest.fn().mockResolvedValue('') } as unknown as SystemConfigService;
    return new AdminCouponBatchService(db.client, config);
  }

  it('admin tắt cả lô khi khách đang nhận: hoặc nhận trước lúc tắt (mã tắt rồi nên vô dụng) hoặc bị từ chối "ngừng áp dụng"; sau đó không ai nhận thêm', async () => {
    const seen = new Set<string>();
    for (const skew of SKEWS) {
      const { db, claims, coupons, owners } = setup({ coupon: { batch: 'THE11' } });
      const [claim, off] = await pair(
        skew,
        () => claims.claim('u1', CODE),
        () => batchService(db).setActive('THE11', false),
      );
      is('lệnh tắt luôn thành công', off.status, 'fulfilled');
      if (claim.status === 'fulfilled') {
        is('nhận được thì đúng một dòng', owners(), ['u1']);
        await expect(coupons.validateAndCompute(CODE, 'u1', 200_000)).rejects.toThrow(INACTIVE);
        seen.add('nhận');
      } else {
        expectRefused(claim, INACTIVE);
        is('bị từ chối thì không có dòng', owners(), []);
        seen.add('từ chối');
      }
      const before = owners();
      expectRefused((await Promise.allSettled([claims.claim('u2', CODE)]))[0]!, INACTIVE);
      is('sau khi tắt không ai nhận thêm', owners(), before);
    }
    is('cả hai thứ tự đều xảy ra', [...seen].sort(), ['nhận', 'từ chối']);
  });

  it('mã hết hạn đúng lúc khách nhận: hoặc nhận trước (dòng vô dụng, giỏ báo hết hạn) hoặc bị từ chối "đã hết hạn"; sau đó không ai nhận thêm', async () => {
    const seen = new Set<string>();
    for (const skew of SKEWS) {
      const { db, claims, coupons, owners } = setup();
      const [claim] = await pair(
        skew,
        () => claims.claim('u1', CODE),
        () => db.client.coupon.update({ where: { id: 'c1' }, data: { endAt: new Date(Date.now() - 1000) } }),
      );
      if (claim.status === 'fulfilled') {
        is('nhận được thì đúng một dòng', owners(), ['u1']);
        await expect(coupons.validateAndCompute(CODE, 'u1', 200_000)).rejects.toThrow('Mã giảm giá đã hết hạn hoặc chưa hiệu lực.');
        seen.add('nhận');
      } else {
        expectRefused(claim, EXPIRED);
        is('bị từ chối thì không có dòng', owners(), []);
        seen.add('từ chối');
      }
      const before = owners();
      expectRefused((await Promise.allSettled([claims.claim('u2', CODE)]))[0]!, EXPIRED);
      is('sau khi hết hạn không ai nhận thêm', owners(), before);
    }
    is('cả hai thứ tự đều xảy ra', [...seen].sort(), ['nhận', 'từ chối']);
  });

  it('đổi tổng lượt 1 → 2 (ghi thẳng dòng mã, không qua AdminService.updateCoupon) lúc hai khách tranh: kết quả khớp một thứ tự tuần tự (một hoặc hai dòng), bên thua bị từ chối bằng câu tiếng Việt', async () => {
    const counts = new Set<number>();
    for (const skew of SKEWS) {
      const { db, claims, owners } = setup({ coupon: { usageLimit: 1 } });
      const lift = () => db.client.coupon.update({ where: { id: 'c1' }, data: { usageLimit: 2 } });
      const rs = await Promise.allSettled([later(Math.max(0, skew), () => claims.claim('u1', CODE)), later(Math.max(0, skew) + 1, () => claims.claim('u2', CODE)), later(Math.max(0, -skew), lift)]);
      const won = fulfilled(rs.slice(0, 2));
      is(`skew ${skew}: số dòng bằng số bên thắng`, owners().length, won);
      expect(won).toBeGreaterThanOrEqual(1);
      expect(won).toBeLessThanOrEqual(2);
      rs.slice(0, 2).filter((r) => r.status === 'rejected').forEach((r) => expectRefused(r, LIMIT_ONE));
      counts.add(won);
    }
    is('cả hai kết quả hợp lệ đều xảy ra', [...counts].sort(), [1, 2]);
  });

  it('đổi tổng lượt 3 → 1 (ghi thẳng dòng mã, không qua AdminService.updateCoupon) khi đã có một dòng: nhận trước lúc hạ thì thêm một dòng (hạ không thu hồi), nhận sau thì bị từ chối; không có kết quả thứ ba', async () => {
    const counts = new Set<number>();
    for (const skew of SKEWS) {
      const { db, claims, owners } = setup({ coupon: { usageLimit: 3 }, claimedBy: ['p1'] });
      const [claim] = await pair(
        skew,
        () => claims.claim('u1', CODE),
        () => db.client.coupon.update({ where: { id: 'c1' }, data: { usageLimit: 1 } }),
      );
      if (claim.status === 'rejected') expectRefused(claim, LIMIT_ONE);
      is(`skew ${skew}: số dòng khớp thứ tự tuần tự`, owners().length, claim.status === 'fulfilled' ? 2 : 1);
      counts.add(owners().length);
    }
    is('cả hai thứ tự đều xảy ra', [...counts].sort(), [1, 2]);
  });
});

describe('CouponClaimService.claimHiddenForCart — race', () => {
  it('gõ mã thẻ ở giỏ hai lần song song (bấm đúp "Áp dụng"): một dòng, cả hai lần không ném lỗi', async () => {
    for (const skew of SKEWS) {
      const { claims, owners } = setup({ coupon: { usageLimit: 1 } });
      const rs = await pair(skew, () => claims.claimHiddenForCart('u1', CODE.toLowerCase()), () => claims.claimHiddenForCart('u1', CODE));
      is(`skew ${skew}: cả hai thành công`, fulfilled(rs), 2);
      is('một dòng', owners(), ['u1']);
    }
  });

  it('gõ mã ở giỏ chen với quét QR của cùng khách: một dòng, cả hai thành công', async () => {
    for (const skew of SKEWS) {
      const { claims, owners } = setup({ coupon: { usageLimit: 1 } });
      const rs = await pair(skew, () => claims.claimHiddenForCart('u1', CODE), () => claims.claim('u1', CODE));
      is(`skew ${skew}: cả hai thành công`, fulfilled(rs), 2);
      is('một dòng', owners(), ['u1']);
    }
  });

  it('thẻ riêng: khách A gõ ở giỏ, khách B quét QR cùng lúc: một dòng, bên thua bị từ chối bằng câu tiếng Việt, bên thắng gõ lại không lỗi', async () => {
    const winners = new Set<string>();
    for (const skew of SKEWS) {
      const { claims, owners } = setup({ coupon: { usageLimit: 1 } });
      const [cart, qr] = await pair(skew, () => claims.claimHiddenForCart('u1', CODE), () => claims.claim('u2', CODE));
      is(`skew ${skew}: một dòng`, owners().length, 1);
      if (cart.status === 'fulfilled') {
        is('A thắng', owners(), ['u1']);
        expectRefused(qr, LIMIT_ONE);
        await expect(claims.claimHiddenForCart('u1', CODE)).resolves.toBeUndefined();
        winners.add('A');
      } else {
        is('B thắng', owners(), ['u2']);
        expectRefused(cart, LIMIT_ONE);
        winners.add('B');
      }
    }
    is('cả hai bên đều từng thắng trong lưới skew', [...winners].sort(), ['A', 'B']);
  });

  it('gõ mã ở giỏ chen với đặt đơn của cùng khách: đặt đơn hoặc thấy dòng vừa nhận (ghi một lượt dùng) hoặc bị từ chối "không áp dụng cho tài khoản này" và không ghi gì; lượt dùng không bao giờ có khi chưa có dòng nhận', async () => {
    const seen = new Set<string>();
    for (const skew of SKEWS) {
      const { db, claims, coupons, owners } = setup({ coupon: { usageLimit: 5 } });
      const [claim, redeem] = await pair(skew, () => claims.claimHiddenForCart('u1', CODE), () => coupons.redeem(CODE, 'u1', 'o1'));
      is(`skew ${skew}: nhận mã không lỗi`, claim.status, 'fulfilled');
      is('một dòng nhận', owners(), ['u1']);
      if (redeem.status === 'fulfilled') {
        is('đặt đơn qua thì một lượt dùng', db.rows('couponRedemption').length, 1);
        is('bộ đếm tăng một', db.row('coupon', 'c1')!.usedCount, 1);
        seen.add('qua');
      } else {
        expectRefused(redeem, 'Mã không áp dụng cho tài khoản này.');
        is('bị từ chối thì không có lượt dùng', db.rows('couponRedemption').length, 0);
        is('bộ đếm giữ nguyên', db.row('coupon', 'c1')!.usedCount, 0);
        seen.add('từ chối');
      }
    }
    is('cả hai thứ tự đều xảy ra', [...seen].sort(), ['qua', 'từ chối']);
  });

  it('mã đã nhận rồi thì gõ ở giỏ không ném lỗi dù mã vừa hết hạn hoặc khách đã dùng hết lượt: giỏ tự báo đúng lý do của nó', async () => {
    const expired = setup({ coupon: { usageLimit: 1, endAt: past(), startAt: new Date(Date.now() - 2 * 864e5) }, claimedBy: ['u1'] });
    await expect(expired.claims.claimHiddenForCart('u1', CODE)).resolves.toBeUndefined();
    await expect(expired.coupons.validateAndCompute(CODE, 'u1', 200_000)).rejects.toThrow('Mã giảm giá đã hết hạn hoặc chưa hiệu lực.');

    const used = setup({ coupon: { usageLimit: 1 }, claimedBy: ['u1'] });
    used.db.seed('couponRedemption', [{ couponId: 'c1', userId: 'u1', orderId: 'o0' }]);
    await expect(used.claims.claimHiddenForCart('u1', CODE)).resolves.toBeUndefined();
    is('không ghi thêm dòng nhận', used.owners(), ['u1']);
  });
});

describe('CouponClaimService.claimHiddenForCart — chỉ đụng tới mã CLAIM', () => {
  it('mã công khai hoặc mã cá nhân của người khác: không ném lỗi, không ghi dòng (giỏ tự báo lỗi của mã); khách vãng lai gõ mã công khai không bị đòi đăng nhập Zalo ở bước này', async () => {
    const guest = { id: 'g1', phone: null, zaloId: 'guest_abc', role: 'CUSTOMER' };
    for (const [label, coupon, userId] of [
      ['công khai, khách thật', { scope: 'PUBLIC' }, 'u1'],
      ['công khai, khách vãng lai', { scope: 'PUBLIC' }, 'g1'],
      ['cá nhân của người khác', { scope: 'USER_GROUP', scopeMeta: { userId: 'u9' } }, 'u1'],
      ['không tồn tại', { code: 'KHAC-AAAA1111' }, 'u1'],
    ] as const) {
      const { db, claims } = setup({ coupon });
      db.seed('user', [guest]);
      await expect(claims.claimHiddenForCart(userId, CODE)).resolves.toBeUndefined();
      is(`${label}: không ghi dòng nhận`, db.rows('couponClaim'), []);
    }
  });
});

describe('CouponClaimService.claim — lý do từ chối (tiếng Việt, mỗi lý do một câu)', () => {
  it('mọi lý do từ chối có dấu, khác nhau và nói đúng nguyên nhân', async () => {
    const reasons: Record<string, string> = {};
    const refuse = async (label: string, run: () => Promise<unknown>) => {
      const r = await Promise.allSettled([run()]);
      is(`${label}: bị từ chối`, r[0]!.status, 'rejected');
      const reason = (r[0] as PromiseRejectedResult).reason as Error;
      expect(reason).toBeInstanceOf(BadRequestException);
      reasons[label] = reason.message;
    };

    await refuse('không tồn tại', () => setup().claims.claim('u1', 'KHONGCO'));
    await refuse('đã tắt', () => setup({ coupon: { isActive: false } }).claims.claim('u1', CODE));
    await refuse('hết hạn', () => setup({ coupon: { startAt: new Date(Date.now() - 2 * 864e5), endAt: past() } }).claims.claim('u1', CODE));
    await refuse('chưa tới ngày', () => setup({ coupon: { startAt: future(), endAt: new Date(Date.now() + 2 * 864e5) } }).claims.claim('u1', CODE));
    await refuse('hết lượt (thẻ riêng)', () => setup({ claimedBy: ['u2'] }).claims.claim('u1', CODE));
    await refuse('hết lượt (mã chung)', () => setup({ coupon: { usageLimit: 2 }, claimedBy: ['u2', 'u3'] }).claims.claim('u1', CODE));
    await refuse('đã dùng rồi', () => {
      const s = setup({ coupon: { usageLimit: 3 }, claimedBy: ['u1'] });
      s.db.seed('couponRedemption', [{ couponId: 'c1', userId: 'u1', orderId: 'o0' }]);
      return s.claims.claim('u1', CODE);
    });
    await refuse('khách vãng lai', () => {
      const s = setup();
      s.db.seed('user', [{ id: 'g1', phone: null, zaloId: 'guest_abc', role: 'CUSTOMER' }]);
      return s.claims.claim('g1', CODE);
    });
    await refuse('chỉ khách mới', () => setup({ coupon: { newCustomerOnly: true }, orders: [{ id: 'o0', userId: 'u1', status: 'DELIVERED' }] }).claims.claim('u1', CODE));
    await refuse('mã cá nhân của người khác', () => setup({ coupon: { scope: 'USER_GROUP', scopeMeta: { userId: 'u9' } } }).claims.claim('u1', CODE));
    await refuse('mã do chính mình tạo', () => setup({ coupon: { createdById: 'u1' } }).claims.claim('u1', CODE));

    for (const [label, message] of Object.entries(reasons)) {
      expect({ label, hasDiacritics: VI.test(message) }).toEqual({ label, hasDiacritics: true });
    }
    is('mỗi lý do một câu riêng', new Set(Object.values(reasons)).size, Object.keys(reasons).length);
    expect(reasons['không tồn tại']).toContain('không tồn tại');
    expect(reasons['đã tắt']).toContain('ngừng áp dụng');
    expect(reasons['hết hạn']).toContain('hết hạn');
    expect(reasons['chưa tới ngày']).toContain('áp dụng từ ngày');
    expect(reasons['hết lượt (thẻ riêng)']).toContain('tài khoản khác nhận');
    expect(reasons['hết lượt (mã chung)']).toContain('hết lượt nhận');
    expect(reasons['đã dùng rồi']).toContain('đã dùng');
    expect(reasons['khách vãng lai']).toContain('đăng nhập Zalo');
    expect(reasons['chỉ khách mới']).toContain('đơn đầu tiên');
  });
});

describe('AdminCouponBatchService.create — race', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const input = (prefix: string) => ({
    prefix,
    quantity: 5,
    type: 'AMOUNT' as const,
    value: 30000,
    minOrder: 99000,
    startAt: new Date().toISOString(),
    endAt: new Date(Date.now() + 30 * 864e5).toISOString(),
  });
  const make = () => {
    const { db } = setup();
    const config = { get: jest.fn().mockResolvedValue('') } as unknown as SystemConfigService;
    return { db, svc: new AdminCouponBatchService(db.client, config) };
  };

  it('bấm "Tạo lô" hai lần cùng tiền tố: một lô đủ số mã, lần sau nhận lỗi 409 tiếng Việt, không gộp thành lô gấp đôi', async () => {
    let collided = 0;
    for (const skew of SKEWS) {
      const { db, svc } = make();
      const rs = await pair(skew, () => svc.create(input('FLASH11')), () => svc.create(input('FLASH11')));
      is(`skew ${skew}: một lần thành công`, fulfilled(rs), 1);
      const lost = rs.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(ConflictException);
      expect((lost.reason as Error).message).toContain('Tiền tố FLASH11 đã dùng cho một lô khác');
      expect((lost.reason as Error).message).toMatch(VI);
      const rows = db.rows('coupon').filter((r) => r.batch === 'FLASH11');
      is('đúng số mã của một lô', rows.length, 5);
      is('mã không trùng', new Set(rows.map((r) => r.code)).size, 5);
      expect(rows.every((r) => r.usageLimit === 1 && r.scope === 'CLAIM' && String(r.code).startsWith('FLASH11-'))).toBe(true);
      collided += db.stats.lockWaits;
    }
    expect(collided).toBeGreaterThan(0);
  });

  it('hai tiền tố khác nhau tạo cùng lúc: cả hai lô đều đủ mã, không chặn nhau', async () => {
    for (const skew of SKEWS.filter((s) => s % 4 === 0)) {
      const { db, svc } = make();
      const rs = await pair(skew, () => svc.create(input('FLASH11')), () => svc.create(input('TET2027')));
      is(`skew ${skew}: cả hai thành công`, fulfilled(rs), 2);
      is('FLASH11', db.rows('coupon').filter((r) => r.batch === 'FLASH11').length, 5);
      is('TET2027', db.rows('coupon').filter((r) => r.batch === 'TET2027').length, 5);
    }
  });
});
