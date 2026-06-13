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
