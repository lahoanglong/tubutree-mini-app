import { CouponsService } from './coupons.service';
import type { PrismaService } from '../../prisma/prisma.service';

const past = new Date(Date.now() - 864e5);
const future = new Date(Date.now() + 864e5);

function coupon(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    code: 'SALE',
    type: 'PERCENT',
    value: 10,
    minOrder: null,
    maxDiscount: null,
    startAt: past,
    endAt: future,
    perUserLimit: 1,
    usageLimit: null,
    ...over,
  };
}

function makeService(c: unknown, counts: number[] = [0, 0]) {
  let i = 0;
  const prisma = {
    coupon: { findUnique: jest.fn().mockResolvedValue(c) },
    couponRedemption: { count: jest.fn().mockImplementation(() => Promise.resolve(counts[i++] ?? 0)) },
  } as unknown as PrismaService;
  return new CouponsService(prisma);
}

describe('CouponsService.validateAndCompute', () => {
  it('mã không tồn tại → lỗi', async () => {
    await expect(makeService(null).validateAndCompute('X', 'u1', 100000)).rejects.toThrow('không tồn tại');
  });

  it('mã hết hạn → lỗi', async () => {
    const svc = makeService(coupon({ endAt: past, startAt: new Date(Date.now() - 2 * 864e5) }));
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).rejects.toThrow('hết hạn');
  });

  it('dưới minOrder → lỗi', async () => {
    const svc = makeService(coupon({ minOrder: 200000 }));
    await expect(svc.validateAndCompute('SALE', 'u1', 150000)).rejects.toThrow('tối thiểu');
  });

  it('PERCENT kẹp theo maxDiscount', async () => {
    const svc = makeService(coupon({ type: 'PERCENT', value: 50, maxDiscount: 30000 }));
    const r = await svc.validateAndCompute('SALE', 'u1', 200000); // 50% = 100k nhưng cap 30k
    expect(r.discount).toBe(30000);
    expect(r.freeship).toBe(false);
  });

  it('AMOUNT không vượt quá subtotal', async () => {
    const svc = makeService(coupon({ type: 'AMOUNT', value: 100000 }));
    const r = await svc.validateAndCompute('SALE', 'u1', 80000);
    expect(r.discount).toBe(80000);
  });

  it('FREESHIP → freeship true, discount 0', async () => {
    const svc = makeService(coupon({ type: 'FREESHIP' }));
    const r = await svc.validateAndCompute('SALE', 'u1', 100000);
    expect(r.freeship).toBe(true);
    expect(r.discount).toBe(0);
  });

  it('hết lượt cá nhân (perUserLimit) → lỗi', async () => {
    const svc = makeService(coupon({ perUserLimit: 1 }), [1]); // đã dùng 1
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).rejects.toThrow('hết lượt');
  });

  it('hết tổng lượt (usageLimit) → lỗi', async () => {
    const svc = makeService(coupon({ usageLimit: 100 }), [0, 100]); // user 0, tổng 100
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).rejects.toThrow('hết lượt sử dụng');
  });
});

function makeServiceScoped(c: unknown, user: unknown = null, counts: number[] = [0, 0]) {
  let i = 0;
  const prisma = {
    coupon: { findUnique: jest.fn().mockResolvedValue(c) },
    couponRedemption: { count: jest.fn().mockImplementation(() => Promise.resolve(counts[i++] ?? 0)) },
    user: { findUnique: jest.fn().mockResolvedValue(user) },
  } as unknown as PrismaService;
  return new CouponsService(prisma);
}

describe('CouponsService.validateAndCompute scope ownership', () => {
  it('USER_GROUP đúng owner → trả CouponResult bình thường', async () => {
    const svc = makeServiceScoped(
      coupon({ scope: 'USER_GROUP', scopeMeta: { userId: 'u1' }, type: 'AMOUNT', value: 20000 }),
    );
    const r = await svc.validateAndCompute('SALE', 'u1', 100000);
    expect(r.discount).toBe(20000);
    expect(r.code).toBe('SALE');
  });

  it('USER_GROUP sai owner → lỗi với message Việt', async () => {
    const svc = makeServiceScoped(
      coupon({ scope: 'USER_GROUP', scopeMeta: { userId: 'u-other' } }),
    );
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).rejects.toThrow(
      'Mã không áp dụng cho tài khoản này.',
    );
  });

  it('TIER khác hạng → lỗi', async () => {
    const svc = makeServiceScoped(
      coupon({ scope: 'TIER', scopeMeta: { tierId: 'GOLD' } }),
      { tierId: 'SILVER' },
    );
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).rejects.toThrow(
      'Mã chỉ áp dụng cho hạng thành viên khác.',
    );
  });
});

// ─────────────────────────────────────────────────────────────
// B4: redeem atomic — bảo vệ usageLimit khỏi race + idempotency cho retry
// ─────────────────────────────────────────────────────────────

function makeRedeemService(opts: {
  coupon: unknown;
  updateManyCount?: number;
  createImpl?: jest.Mock;
  perUserCount?: number;
}) {
  const updateMany = jest
    .fn()
    .mockResolvedValue({ count: opts.updateManyCount ?? 1 });
  const create = opts.createImpl ?? jest.fn().mockResolvedValue({ id: 'r1' });
  // perUserLimit re-check trong redeem (in-tx) gọi couponRedemption.count.
  // Mặc định 0 → chưa dùng lần nào → pass.
  const count = jest.fn().mockResolvedValue(opts.perUserCount ?? 0);
  const prisma = {
    coupon: {
      findUnique: jest.fn().mockResolvedValue(opts.coupon),
      updateMany,
    },
    couponRedemption: { create, count },
  } as unknown as PrismaService;
  const svc = new CouponsService(prisma);
  return { svc, updateMany, create, count };
}

describe('CouponsService.redeem atomic (B4)', () => {
  it('usageLimit chưa đạt → updateMany count=1, tạo redemption OK', async () => {
    const { svc, updateMany, create } = makeRedeemService({
      coupon: coupon({ usageLimit: 100 }),
      updateManyCount: 1,
    });
    await svc.redeem('SALE', 'u1', 'o1');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', usedCount: { lt: 100 } },
      data: { usedCount: { increment: 1 } },
    });
    expect(create).toHaveBeenCalledWith({
      data: { couponId: 'c1', userId: 'u1', orderId: 'o1' },
    });
  });

  it('usageLimit đã đạt (updateMany count=0) → BadRequestException, KHÔNG tạo redemption', async () => {
    const { svc, create } = makeRedeemService({
      coupon: coupon({ usageLimit: 1 }),
      updateManyCount: 0,
    });
    await expect(svc.redeem('SALE', 'u1', 'o1')).rejects.toThrow(
      'hết lượt sử dụng',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('race orderId trùng (P2002) → no-op, không throw', async () => {
    // Mock lỗi Prisma P2002 — instance của PrismaClientKnownRequestError.
    const { Prisma } = jest.requireActual('@prisma/client');
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const createImpl = jest.fn().mockRejectedValue(p2002);
    const { svc } = makeRedeemService({
      coupon: coupon({ usageLimit: null }),
      createImpl,
    });
    await expect(svc.redeem('SALE', 'u1', 'o1')).resolves.toBeUndefined();
    expect(createImpl).toHaveBeenCalled();
  });

  it('usageLimit null → bỏ qua atomic update, tạo redemption trực tiếp', async () => {
    const { svc, updateMany, create } = makeRedeemService({
      coupon: coupon({ usageLimit: null }),
    });
    await svc.redeem('SALE', 'u1', 'o1');
    expect(updateMany).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });
});
