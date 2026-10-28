import type { Prisma } from '@prisma/client';
import { countHarvestCoupons, harvestCouponCountSql } from './harvest-coupon-count';

const DAY = new Date('2026-10-28T17:00:00Z');
const MONTH = new Date('2026-09-30T17:00:00Z');

describe('countHarvestCoupons', () => {
  it('ép bigint của count(*) về number và trả đủ số ngày + số tháng từ một câu truy vấn', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ day: BigInt(2), month: BigInt(5) }]) } as unknown as Prisma.TransactionClient;
    await expect(countHarvestCoupons(tx, 'u1', DAY, MONTH)).resolves.toEqual({ day: 2, month: 5 });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('không có dòng nào (hoặc dòng rỗng) → 0 và 0', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) } as unknown as Prisma.TransactionClient;
    await expect(countHarvestCoupons(tx, 'u1', DAY, MONTH)).resolves.toEqual({ day: 0, month: 0 });
  });

  it('SQL: chỉ mã USER_GROUP của đúng khách, tiền tố HARVEST/GARDEN (không có GAME), mốc ngày và tháng làm tham số', () => {
    const sql = harvestCouponCountSql('u1', DAY, MONTH);
    expect(sql.values).toEqual([DAY, MONTH, 'u1', 'HARVEST%', 'GARDEN%']);
    expect(sql.sql).toContain(`"scope" = 'USER_GROUP'`);
    expect(sql.sql).toContain(`("scopeMeta" ->> 'userId') = `);
    expect(sql.sql).toContain('"code" LIKE');
    expect(sql.sql).not.toMatch(/GAME/);
  });
});
