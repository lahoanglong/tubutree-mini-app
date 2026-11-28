import { Prisma } from '@prisma/client';
import { averageOrderValue, couponRoiBatch, toCount, ZERO_COUPON_ROI } from './coupon-roi';

const dbOf = (rows: unknown[]) => ({ $queryRaw: jest.fn().mockResolvedValue(rows) });
type Db = Parameters<typeof couponRoiBatch>[0];
const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?').replace(/\s+/g, ' ');

describe('toCount', () => {
  it('bigint, chuỗi số và số thập phân về số nguyên không âm; giá trị lạ về 0', () => {
    expect(toCount(12n)).toBe(12);
    expect(toCount('1250000')).toBe(1_250_000);
    expect(toCount(3.9)).toBe(3);
    expect(toCount(-5)).toBe(0);
    expect(toCount(null)).toBe(0);
    expect(toCount(undefined)).toBe(0);
    expect(toCount('abc')).toBe(0);
  });
});

describe('averageOrderValue', () => {
  it('gmv chia số đơn, làm tròn; chưa có đơn thì 0 (không chia cho 0)', () => {
    expect(averageOrderValue(1_000_000, 3)).toBe(333_333);
    expect(averageOrderValue(100, 3)).toBe(33);
    expect(averageOrderValue(0, 0)).toBe(0);
    expect(averageOrderValue(500, 0)).toBe(0);
  });
});

describe('couponRoiBatch', () => {
  it('không có mã nào: không truy vấn DB', async () => {
    const db = dbOf([]);
    expect((await couponRoiBatch(db as unknown as Db, [])).size).toBe(0);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('một truy vấn cho cả lô: số đơn, GMV, tiền giảm và giá trị đơn trung bình theo từng mã (kết quả bigint của Postgres)', async () => {
    const db = dbOf([
      { id: 'c1', orders: 4n, gmv: 1_000_000n, discount: 80_000n },
      { id: 'c2', orders: '1', gmv: '250000', discount: '0' },
    ]);
    const out = await couponRoiBatch(db as unknown as Db, ['c1', 'c2', 'c3']);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(out.get('c1')).toEqual({ ordersCount: 4, gmv: 1_000_000, discountCost: 80_000, avgOrderValue: 250_000 });
    expect(out.get('c2')).toEqual({ ordersCount: 1, gmv: 250_000, discountCost: 0, avgOrderValue: 250_000 });
    // Mã chưa có đơn không có trong kết quả: nơi dùng đọc `?? ZERO_COUPON_ROI`.
    expect(out.has('c3')).toBe(false);
    expect(ZERO_COUPON_ROI).toEqual({ ordersCount: 0, gmv: 0, discountCost: 0, avgOrderValue: 0 });
  });

  it('SQL: chỉ đơn của đúng các mã được hỏi, theo định nghĩa GMV của admin (đơn đang chạy/đã giao, bỏ đơn thử đã dọn), gom theo mã', async () => {
    const db = dbOf([]);
    await couponRoiBatch(db as unknown as Db, ['c1', 'c2']);
    const call = db.$queryRaw.mock.calls[0]!;
    const text = sqlOf(call);
    // Giỏ tách nhiều đơn giao chỉ ghi lượt dùng mã ở đơn đầu: đơn con cùng checkoutGroup tính chung (`=` với NULL không khớp nên đơn lẻ không dính nhau).
    expect(text).toContain('FROM coupon_redemptions r JOIN orders p ON p.id = r."orderId" JOIN orders o ON o.id = p.id OR o."checkoutGroup" = p."checkoutGroup"');
    expect(text).toContain('r."couponId" IN (?)');
    expect(text).toContain('GROUP BY r."couponId"');
    expect(text).toContain('SUM(o."couponDiscount")');
    const values = call.slice(1) as unknown[];
    const [ids, gmvRule] = values as [Prisma.Sql, Prisma.Sql];
    expect(ids.values).toEqual(['c1', 'c2']);
    expect(gmvRule.sql).toContain(`o.status IN ('CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED')`);
    expect(gmvRule.sql).toContain('o.code NOT IN');
  });

  it('dòng hỏng (thiếu trường, giá trị lạ) không làm vỡ cả danh sách', async () => {
    const out = await couponRoiBatch(dbOf([{ id: 'c1' }, { id: 'c2', orders: 'x', gmv: -1, discount: null }]) as unknown as Db, ['c1', 'c2']);
    expect(out.get('c1')).toEqual(ZERO_COUPON_ROI);
    expect(out.get('c2')).toEqual(ZERO_COUPON_ROI);
  });
});
