import { PURCHASE_FUNNEL_STEPS } from '@tubutree/shared-types';
import type { PrismaService } from '../../prisma/prisma.service';
import { PurchaseFunnelService } from './purchase-funnel.service';

const row = (platform: string, n: [number, number, number, number, number, number]) => ({
  platform,
  sessions: BigInt(n[0]),
  product_viewed: BigInt(n[1]),
  add_or_buy: BigInt(n[2]),
  checkout_started: BigInt(n[3]),
  place_order_click: BigInt(n[4]),
  order_placed: BigInt(n[5]),
});

describe('PurchaseFunnelService', () => {
  const now = new Date('2026-11-16T15:00:00.000Z');

  it('ba cửa sổ, đủ 5 bước theo thứ tự, bigint thành number, total = web + miniapp', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([row('web', [10, 8, 4, 3, 2, 1]), row('miniapp', [5, 4, 2, 1, 1, 1])]);
    const dto = await new PurchaseFunnelService({ $queryRaw } as unknown as PrismaService).getSnapshot(now);
    expect(Object.keys(dto.windows)).toEqual(['h72', 'd7', 'd30']);
    expect(dto.generatedAt).toBe(now.toISOString());
    const w = dto.windows.h72;
    expect(w.rows.map((r) => r.step)).toEqual([...PURCHASE_FUNNEL_STEPS]);
    expect(w.rows[0]).toEqual({ step: 'product_viewed', web: 8, miniapp: 4, total: 12 });
    expect(w.rows[4]).toEqual({ step: 'order_placed', web: 1, miniapp: 1, total: 2 });
    expect(w.sessions).toEqual({ web: 10, miniapp: 5, total: 15 });
    expect($queryRaw).toHaveBeenCalledTimes(3);
  });

  it('không có dữ liệu: mọi bước 0', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([]);
    const dto = await new PurchaseFunnelService({ $queryRaw } as unknown as PrismaService).getSnapshot(now);
    expect(dto.windows.d30.rows.every((r) => r.web === 0 && r.miniapp === 0 && r.total === 0)).toBe(true);
    expect(dto.windows.d30.sessions).toEqual({ web: 0, miniapp: 0, total: 0 });
  });

  it('chạy tuần tự (một truy vấn tại một thời điểm) và đệm 60 giây; lỗi thì lần sau tính lại', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const $queryRaw = jest.fn().mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return [];
    });
    const svc = new PurchaseFunnelService({ $queryRaw } as unknown as PrismaService);
    await svc.getSnapshot(now);
    await svc.getSnapshot(new Date(now.getTime() + 59_000));
    expect($queryRaw).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(1);
    await svc.getSnapshot(new Date(now.getTime() + 61_000));
    expect($queryRaw).toHaveBeenCalledTimes(6);

    const failing = jest.fn().mockRejectedValueOnce(new Error('db')).mockResolvedValue([]);
    const svc2 = new PurchaseFunnelService({ $queryRaw: failing } as unknown as PrismaService);
    await expect(svc2.getSnapshot(now)).rejects.toThrow('db');
    await expect(svc2.getSnapshot(now)).resolves.toBeDefined();
  });

  it('kết quả chỉ có số đếm', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([row('web', [1, 1, 1, 1, 1, 1])]);
    const dto = await new PurchaseFunnelService({ $queryRaw } as unknown as PrismaService).getSnapshot(now);
    const json = JSON.stringify(dto);
    expect(json).not.toMatch(/userId|sessionId|anonymousId|eventId/);
  });
});
