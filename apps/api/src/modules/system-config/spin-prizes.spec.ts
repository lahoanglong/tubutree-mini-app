import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { SPIN_POINTS_PRIZE_MAX, spinPrizeProblem } from './spin-prizes';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * PF-6a: `game.spin_prizes` là khoá duy nhất đưa số liệu thưởng của khách vào GameService.creditPoints. Trước đây ghi
 * khoá này không qua luật nào (RANGES chỉ kiểm số, JSON_RULES không có khoá), nên admin gõ một giải POINTS value âm thì
 * lần quay trúng giải đó đi vào nhánh trừ điểm của creditPoints: trừ điểm của khách NGOÀI lockedOrderPoints và thành
 * "thưởng" làm khách mất điểm.
 */
const KEY = 'game.spin_prizes';
const ok = { id: 'p1', name: '5 điểm Xanh', weight: 30, rewardType: 'POINTS', value: 5 };

function service() {
  const upsert = jest.fn().mockResolvedValue({});
  const base: Record<string, unknown> = {
    systemConfig: { findUnique: jest.fn().mockResolvedValue({ value: [ok] }), upsert },
    systemConfigHistory: { create: jest.fn().mockResolvedValue({}) },
  };
  base.$transaction = jest.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(base));
  return { svc: new SystemConfigService(base as unknown as PrismaService), upsert };
}

describe('spinPrizeProblem', () => {
  it('giải hợp lệ của mọi loại → null', () => {
    expect(spinPrizeProblem(ok)).toBeNull();
    expect(spinPrizeProblem({ id: 'c', name: 'Voucher 20k', weight: 10, rewardType: 'COUPON', value: 20000 })).toBeNull();
    expect(spinPrizeProblem({ id: 's', name: '30 giọt', weight: 15, rewardType: 'SEEDS', value: 30 })).toBeNull();
    expect(spinPrizeProblem({ id: 'n', name: 'Chúc may mắn', weight: 0, rewardType: 'NONE', value: 0 })).toBeNull();
  });

  it('weight được phép lẻ (chỉ là tỉ trọng của pickWeighted); value lớn nhất vừa cột Int của DB vẫn hợp lệ', () => {
    expect(spinPrizeProblem({ ...ok, weight: 0.5 })).toBeNull();
    for (const rewardType of ['COUPON', 'SEEDS', 'NONE']) {
      expect(spinPrizeProblem({ id: 'x', name: 'x', weight: 1, rewardType, value: 2 ** 31 - 1 })).toBeNull();
    }
  });

  it('giải POINTS có trần nghiệp vụ 100.000 Điểm Xanh: đúng trần qua, hơn trần một điểm bị từ chối', () => {
    expect(SPIN_POINTS_PRIZE_MAX).toBe(100_000);
    expect(spinPrizeProblem({ ...ok, value: SPIN_POINTS_PRIZE_MAX })).toBeNull();
    expect(spinPrizeProblem({ ...ok, value: 1 })).toBeNull();
    expect(spinPrizeProblem({ ...ok, value: SPIN_POINTS_PRIZE_MAX + 1 })).toMatch(/POINTS.*100/);
  });

  it.each([
    ['POINTS value âm', { ...ok, value: -5 }, /POINTS/],
    ['POINTS value 0', { ...ok, value: 0 }, /POINTS/],
    ['POINTS value lẻ', { ...ok, value: 2.5 }, /POINTS/],
    ['POINTS value NaN', { ...ok, value: Number.NaN }, /value/],
    ['POINTS value là chuỗi', { ...ok, value: '5' }, /value/],
    ['SEEDS value âm (trừ giọt nước của khách)', { id: 's', name: 'x', weight: 1, rewardType: 'SEEDS', value: -30 }, /value/],
    ['COUPON value âm', { id: 'c', name: 'x', weight: 1, rewardType: 'COUPON', value: -20000 }, /value/],
    ['SEEDS value lẻ (DB cắt phần lẻ, khách thấy 2.5 nhưng nhận 2)', { id: 's', name: 'x', weight: 1, rewardType: 'SEEDS', value: 2.5 }, /value/],
    ['COUPON value lẻ', { id: 'c', name: 'x', weight: 1, rewardType: 'COUPON', value: 20000.5 }, /value/],
    ['NONE value lẻ', { id: 'n', name: 'x', weight: 1, rewardType: 'NONE', value: 0.5 }, /value/],
    ['COUPON value vượt cột Int của DB (lượt quay trúng giải này lỗi 500 mỗi lần)', { id: 'c', name: 'x', weight: 1, rewardType: 'COUPON', value: 2 ** 31 }, /value/],
    ['SEEDS value vượt cột Int của DB', { id: 's', name: 'x', weight: 1, rewardType: 'SEEDS', value: 3e9 }, /value/],
    ['NONE value vượt cột Int của DB', { id: 'n', name: 'x', weight: 1, rewardType: 'NONE', value: 1e12 }, /value/],
    ['POINTS value vượt cột Int của DB', { ...ok, value: 2 ** 31 }, /POINTS/],
    ['POINTS value gõ nhầm đơn vị (1.000.000 thay vì 100)', { ...ok, value: 1_000_000 }, /POINTS/],
    ['POINTS value sát trần cột Int', { ...ok, value: 2 ** 31 - 1 }, /POINTS/],
    ['weight âm', { ...ok, weight: -1 }, /weight/],
    ['weight Infinity', { ...ok, weight: Number.POSITIVE_INFINITY }, /weight/],
    ['rewardType lạ', { ...ok, rewardType: 'XU' }, /rewardType/],
    ['thiếu id', { ...ok, id: '' }, /id/],
    ['thiếu name', { ...ok, name: undefined }, /name/],
    ['không phải object', 'p1', /object/],
    ['null', null, /object/],
  ])('%s → có lý do', (_label, prize, reason) => {
    expect(spinPrizeProblem(prize)).toMatch(reason);
  });
});

describe('SystemConfigService.set — game.spin_prizes', () => {
  it('giải POINTS value âm bị từ chối lúc ghi, không ghi gì vào DB', async () => {
    const { svc, upsert } = service();

    const err = await svc.set(KEY, [ok, { ...ok, id: 'bad', value: -10 }], 'admin1').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toMatch(/game\.spin_prizes/);
    expect((err as Error).message).toMatch(/bad/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('không phải mảng → từ chối', async () => {
    const { svc, upsert } = service();
    await expect(svc.set(KEY, { id: 'p1' }, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('bảng giải hợp lệ được ghi; mảng rỗng (tắt vòng quay) cũng ghi được', async () => {
    const { svc, upsert } = service();
    await svc.set(KEY, [ok, { id: 'n', name: 'Chúc may mắn', weight: 2, rewardType: 'NONE', value: 0 }], 'admin1');
    await svc.set(KEY, [], 'admin1');
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('bảng giải mặc định trong seed qua được luật ghi', () => {
    const src = readFileSync(join(__dirname, '../../../prisma/seed.ts'), 'utf-8');
    const start = src.indexOf("key: 'game.spin_prizes'");
    const open = src.indexOf('[', src.indexOf('value:', start));
    const close = src.indexOf('],\n    category', open);
    const prizes = new Function(`return ${src.slice(open, close + 1)};`)() as unknown[];
    expect(prizes.length).toBeGreaterThan(0);
    for (const p of prizes) expect(spinPrizeProblem(p)).toBeNull();
  });
});
