import { NotFoundException } from '@nestjs/common';
import { GreenCardService } from './green-card.service';
import { REFERRAL_FIRST_ORDER_MIN_KEY, REFERRAL_VIRAL_ENABLED_KEY } from './viral-config';

function make(opts: { cfg?: Record<string, unknown>; role?: string; album?: () => Promise<unknown>; wasteSum?: number | null } = {}) {
  const cfg: Record<string, unknown> = { [REFERRAL_VIRAL_ENABLED_KEY]: true, ...opts.cfg };
  const prisma = {
    user: { findUniqueOrThrow: jest.fn(async () => ({ referralCode: 'TUBU123', role: opts.role ?? 'CUSTOMER' })) },
    wasteRequestLine: { aggregate: jest.fn(async () => ({ _sum: { receivedQty: opts.wasteSum === undefined ? 7 : opts.wasteSum } })) },
  };
  const config = { get: async <T,>(k: string, fb?: T) => (k in cfg ? (cfg[k] as T) : (fb as T)) };
  const album = { album: jest.fn(opts.album ?? (async () => ({ seen: 12, total: 40, mastered: 3 }))) };
  return { svc: new GreenCardService(prisma as never, config as never, album as never), prisma, album };
}

describe('GreenCardService.card', () => {
  it('cờ tắt: 404, không đọc gì', async () => {
    const { svc, prisma } = make({ cfg: { [REFERRAL_VIRAL_ENABLED_KEY]: false } });
    await expect(svc.card('u1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('đủ số: thẻ đã mở, vỏ đã đổi (chỉ yêu cầu đã hoàn tất của chính khách), mã mời, luật thưởng đơn đầu', async () => {
    const { svc, prisma, album } = make({ cfg: { [REFERRAL_FIRST_ORDER_MIN_KEY]: 250_000 } });
    expect(await svc.card('u1')).toEqual({
      referralCode: 'TUBU123',
      album: { seen: 12, total: 40 },
      wasteItems: 7,
      firstOrderReward: { points: 100, minOrderAmount: 250_000 },
      earnsPoints: true,
    });
    expect(album.album).toHaveBeenCalledWith('u1', { summary: true });
    expect(prisma.wasteRequestLine.aggregate).toHaveBeenCalledWith({ where: { request: { userId: 'u1', status: 'COMPLETED' } }, _sum: { receivedQty: true } });
  });

  it('Sổ tay tắt (404) hoặc lỗi: thẻ vẫn trả, album null; chưa đổi rác: 0', async () => {
    const { svc } = make({ album: async () => Promise.reject(new NotFoundException()), wasteSum: null });
    expect(await svc.card('u1')).toMatchObject({ album: null, wasteItems: 0 });
  });

  it('CTV không nhận Điểm Xanh giới thiệu', async () => {
    const { svc } = make({ role: 'AFFILIATE' });
    expect(await svc.card('u1')).toMatchObject({ earnsPoints: false });
  });
});
