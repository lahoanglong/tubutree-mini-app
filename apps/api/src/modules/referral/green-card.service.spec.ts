import { NotFoundException } from '@nestjs/common';
import { GreenCardService } from './green-card.service';
import { REFERRAL_FIRST_ORDER_MIN_KEY, REFERRAL_VIRAL_ENABLED_KEY } from './viral-config';

function make(
  opts: { cfg?: Record<string, unknown>; user?: Record<string, unknown>; album?: () => Promise<unknown>; wasteSum?: number | null; monthCount?: number } = {},
) {
  const cfg: Record<string, unknown> = { [REFERRAL_VIRAL_ENABLED_KEY]: true, ...opts.cfg };
  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn(async () => ({ referralCode: 'TUBU123', role: 'CUSTOMER', isBlocked: false, metadata: null, phone: '0901111111', zaloId: 'zalo-u', ...opts.user })),
    },
    pointsTransaction: {
      findMany: jest.fn(async () => Array.from({ length: opts.monthCount ?? 0 }, (_, i) => ({ reason: `REFERRAL_FIRST_ORDER_REFERRER:f${i}` }))),
      count: jest.fn(async () => 0),
    },
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

  it.each([
    ['CTV', { role: 'AFFILIATE' }],
    ['khách chưa xác thực', { phone: null, zaloId: 'guest_abc' }],
    ['tài khoản bị khoá', { isBlocked: true }],
    ['chủ gian hàng mẫu', { metadata: { sampleStorefront: true } }],
  ])('không hứa thưởng khi máy chủ sẽ không trả: %s', async (_name, user) => {
    const { svc } = make({ user });
    expect(await svc.card('u1')).toMatchObject({ earnsPoints: false });
  });

  it('đã đủ trần tháng: thẻ không hứa thưởng nữa', async () => {
    expect(await make({ monthCount: 10 }).svc.card('u1')).toMatchObject({ earnsPoints: false });
    expect(await make({ monthCount: 9 }).svc.card('u1')).toMatchObject({ earnsPoints: true });
  });
});
