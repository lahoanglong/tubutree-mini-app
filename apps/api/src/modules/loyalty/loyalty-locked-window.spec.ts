import { BadRequestException } from '@nestjs/common';
import { DEFAULT_REWARD_CATALOG, LoyaltyService } from './loyalty.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const DAY = 864e5;

/**
 * PF-6a: lockedOrderPoints đọc `returns.window_days` qua SystemConfigService. Lần trượt cache của lệnh get lấy THÊM một
 * kết nối pool, nên caller đang ở trong tx (đang giữ một kết nối và khoá dòng user) phải đọc cửa sổ NGOÀI tx rồi truyền
 * vào. Caller ngoài tx (tổng quan, báo giá) không truyền thì vẫn tự đọc như cũ.
 */
function setup(windowDays: unknown = 7) {
  const events: string[] = [];
  const state = { txOpen: false, getsInsideTx: 0 };
  const get = jest.fn(async <T>(key: string, fallback?: T): Promise<T> => {
    events.push(`get:${key}`);
    if (state.txOpen) state.getsInsideTx += 1;
    return (key === 'returns.window_days' ? windowDays : fallback) as T;
  });
  const config = { get } as unknown as SystemConfigService;
  const queryRaw = jest.fn(async (..._args: unknown[]) => [] as unknown[]);
  const tx = {
    $queryRaw: queryRaw,
    user: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue({ pointsBalance: 0 }),
    },
  };
  const prisma = {
    $queryRaw: queryRaw,
    $transaction: jest.fn(async (cb: (t: unknown) => unknown) => {
      events.push('tx:open');
      state.txOpen = true;
      try {
        return await cb(tx);
      } finally {
        state.txOpen = false;
        events.push('tx:close');
      }
    }),
  } as unknown as PrismaService;
  return { svc: new LoyaltyService(prisma, config), get, prisma, queryRaw, events, state };
}

/** Dòng "điểm đang khoá" mà câu SQL trả về: đơn giao 2 ngày trước, +20 điểm. */
const lockedRow = (deliveredAt: Date) => [{ delta: 20, deliveredAt, pendingReturn: false }];

describe('PF-6a LoyaltyService.lockedOrderPoints: cửa sổ đổi/trả đọc ngoài tx', () => {
  it('(a) có truyền windowDays thì KHÔNG đọc cấu hình, và dùng đúng giá trị truyền vào để tính mốc mở khoá', async () => {
    const { svc, get, queryRaw } = setup(7);
    const deliveredAt = new Date('2026-10-01T00:00:00.000Z');
    queryRaw.mockResolvedValueOnce(lockedRow(deliveredAt));

    const lock = await svc.lockedOrderPoints('u1', new Date('2026-10-03T00:00:00.000Z'), undefined, 3);

    expect(get).not.toHaveBeenCalled();
    expect(lock.locked).toBe(20);
    expect(lock.lockedUntil?.getTime()).toBe(deliveredAt.getTime() + 3 * DAY);
  });

  it('(a) windowDays truyền vào cũng quyết định mốc cắt của câu SQL (cutoff = now - windowDays)', async () => {
    const { svc, queryRaw } = setup(7);
    const now = new Date('2026-10-12T00:00:00.000Z');

    await svc.lockedOrderPoints('u1', now, undefined, 3);

    // Mẫu tagged-template: giá trị nội suy đi sau mảng chuỗi; có đúng một Date là cutoff (hai lần xuất hiện).
    const dates = queryRaw.mock.calls[0]!.slice(1).filter((v): v is Date => v instanceof Date);
    expect(dates.length).toBeGreaterThan(0);
    expect(new Set(dates.map((d) => d.getTime()))).toEqual(new Set([now.getTime() - 3 * DAY]));
  });

  it('(a) windowDays = 0 là giá trị hợp lệ (không rơi về cấu hình): cửa sổ 0 ngày', async () => {
    const { svc, get, queryRaw } = setup(7);
    const deliveredAt = new Date('2026-10-01T00:00:00.000Z');
    queryRaw.mockResolvedValueOnce(lockedRow(deliveredAt));

    const lock = await svc.lockedOrderPoints('u1', new Date('2026-10-12T00:00:00.000Z'), undefined, 0);

    expect(get).not.toHaveBeenCalled();
    expect(lock.lockedUntil?.getTime()).toBe(deliveredAt.getTime());
  });

  it('(a) không truyền windowDays thì vẫn đọc returns.window_days đúng một lần như cũ (tổng quan, báo giá)', async () => {
    const { svc, get, queryRaw } = setup(5);
    const deliveredAt = new Date('2026-10-01T00:00:00.000Z');
    queryRaw.mockResolvedValueOnce(lockedRow(deliveredAt));

    const lock = await svc.lockedOrderPoints('u1', new Date('2026-10-03T00:00:00.000Z'));

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('returns.window_days', 7);
    expect(lock.lockedUntil?.getTime()).toBe(deliveredAt.getTime() + 5 * DAY);
  });

  it('returnWindowDays là public, mặc định 7 và cấu hình sai kiểu / âm rơi về 7', async () => {
    expect(await setup(10).svc.returnWindowDays()).toBe(10);
    expect(await setup('abc').svc.returnWindowDays()).toBe(7);
    expect(await setup(-2).svc.returnWindowDays()).toBe(7);
    expect(await setup(0).svc.returnWindowDays()).toBe(0);
  });

  it('(b) redeemReward: đọc cấu hình TRƯỚC khi mở transaction và không có lần get nào bên trong tx', async () => {
    const { svc, get, prisma, events, state } = setup(7);

    await expect(svc.redeemReward('u1', DEFAULT_REWARD_CATALOG[0]!.id)).rejects.toBeInstanceOf(BadRequestException);

    expect(get).toHaveBeenCalledWith('returns.window_days', 7);
    expect(state.getsInsideTx).toBe(0);
    expect(events.indexOf('get:returns.window_days')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('get:returns.window_days')).toBeLessThan(events.indexOf('tx:open'));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('(b) redeemReward: mã quà không tồn tại thì không đọc cấu hình và không mở transaction', async () => {
    const { svc, get, prisma } = setup(7);

    await expect(svc.redeemReward('u1', 'khong-co')).rejects.toThrow(/không tồn tại/);

    expect(get).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
