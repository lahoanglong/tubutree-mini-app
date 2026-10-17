import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { REAL_USER_REQUIRED_MSG } from '../../common/real-user';
import { CouponClaimService } from './coupon-claim.service';
import { NEW_CUSTOMER_ONLY_MSG } from './coupons.service';

const past = new Date(Date.now() - 864e5);
const future = new Date(Date.now() + 864e5);
const REAL = { id: 'u1', tierId: null, phone: '0912345678', zaloId: 'z1' };
const GUEST = { id: 'u1', tierId: null, phone: null, zaloId: 'guest_abc' };

function coupon(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    code: 'SHOPEE-AB12CD34',
    type: 'AMOUNT',
    value: 30000,
    minOrder: 99000,
    maxDiscount: null,
    startAt: past,
    endAt: future,
    usageLimit: 1,
    perUserLimit: 1,
    isActive: true,
    scope: 'CLAIM',
    scopeMeta: null,
    newCustomerOnly: true,
    ...over,
  };
}

function make(opts: { coupon?: unknown; user?: unknown; claimed?: boolean; claimCount?: number; priorOrder?: boolean; used?: number } = {}) {
  const calls: string[] = [];
  const createMany = jest.fn().mockImplementation(() => {
    calls.push('insert');
    return Promise.resolve({ count: 1 });
  });
  const claimFindUnique = jest.fn().mockResolvedValue(opts.claimed ? { id: 'cl0' } : null);
  const claimCount = jest.fn().mockImplementation(() => {
    calls.push('count');
    return Promise.resolve(opts.claimCount ?? 0);
  });
  const executeRaw = jest.fn().mockImplementation(() => {
    calls.push('lock');
    return Promise.resolve(0);
  });
  const findCoupon = jest.fn().mockResolvedValue(opts.coupon === undefined ? coupon() : opts.coupon);
  const base: Record<string, unknown> = {
    coupon: { findUnique: findCoupon },
    user: { findUnique: jest.fn().mockResolvedValue(opts.user ?? REAL) },
    couponClaim: { findUnique: claimFindUnique, count: claimCount, createMany },
    couponRedemption: { count: jest.fn().mockResolvedValue(opts.used ?? 0) },
    order: { findFirst: jest.fn().mockResolvedValue(opts.priorOrder ? { id: 'o0' } : null) },
    $executeRaw: executeRaw,
  };
  base.$transaction = jest.fn().mockImplementation((cb: (tx: unknown) => unknown) => cb(base));
  const svc = new CouponClaimService(base as unknown as PrismaService);
  return { svc, calls, createMany, executeRaw, findCoupon, transaction: base.$transaction as jest.Mock };
}

describe('CouponClaimService.claim (D2-03: nhận mã từ thẻ trong hộp hàng)', () => {
  it('chuẩn hoá mã (HOA, bỏ khoảng trắng) rồi ghi lượt nhận; trả thông tin ưu đãi để hiện cho khách', async () => {
    const { svc, findCoupon, createMany } = make();
    const r = await svc.claim('u1', ' shopee-ab12cd34 ');
    expect(findCoupon).toHaveBeenCalledWith({ where: { code: 'SHOPEE-AB12CD34' } });
    expect(createMany).toHaveBeenCalledWith({ data: [{ couponId: 'c1', userId: 'u1' }], skipDuplicates: true });
    expect(r).toEqual({
      code: 'SHOPEE-AB12CD34',
      type: 'AMOUNT',
      value: 30000,
      minOrder: 99000,
      maxDiscount: null,
      endAt: future,
      newCustomerOnly: true,
      alreadyClaimed: false,
    });
  });

  it('idempotent: khách quét lại thẻ đã nhận → trả kết quả cũ, không mở transaction, không ghi thêm', async () => {
    const { svc, createMany, transaction } = make({ claimed: true });
    await expect(svc.claim('u1', 'SHOPEE-AB12CD34')).resolves.toMatchObject({ alreadyClaimed: true });
    expect(transaction).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('mã có tổng lượt: khoá theo mã rồi mới đếm lượt nhận và ghi (số người nhận không vượt tổng lượt)', async () => {
    const { svc, calls, executeRaw } = make({ coupon: coupon({ usageLimit: 500 }), claimCount: 10 });
    await svc.claim('u1', 'SHOPEE-AB12CD34');
    expect(calls).toEqual(['lock', 'count', 'insert']);
    expect(executeRaw.mock.calls[0].slice(1)).toEqual(['coupon-claim', 'c1']);
  });

  it('mã thẻ riêng (1 lượt) đã có người khác nhận → từ chối, không ghi', async () => {
    const { svc, createMany } = make({ claimCount: 1 });
    await expect(svc.claim('u1', 'SHOPEE-AB12CD34')).rejects.toThrow('Mã ưu đãi này đã được tài khoản khác nhận.');
    expect(createMany).not.toHaveBeenCalled();
  });

  it('mã chung hết lượt nhận → từ chối', async () => {
    const { svc } = make({ coupon: coupon({ usageLimit: 200 }), claimCount: 200 });
    await expect(svc.claim('u1', 'SHOPEE-AB12CD34')).rejects.toThrow('Mã ưu đãi đã hết lượt nhận.');
  });

  it('mã không giới hạn tổng lượt → không khoá, ON CONFLICT DO NOTHING chặn trùng khi nhận song song', async () => {
    const { svc, calls } = make({ coupon: coupon({ usageLimit: null }) });
    await svc.claim('u1', 'SHOPEE-AB12CD34');
    expect(calls).toEqual(['insert']);
  });

  it.each([
    ['không tồn tại', null, 'Mã ưu đãi không tồn tại'],
    ['đã tắt', coupon({ isActive: false }), 'Mã ưu đãi đã ngừng áp dụng.'],
    ['hết hạn', coupon({ startAt: new Date(Date.now() - 2 * 864e5), endAt: past }), 'Mã ưu đãi đã hết hạn.'],
    ['chưa tới ngày', coupon({ startAt: future, endAt: new Date(Date.now() + 2 * 864e5) }), 'Mã ưu đãi áp dụng từ ngày'],
  ])('mã %s → từ chối, không ghi', async (_name, c, msg) => {
    const { svc, createMany } = make({ coupon: c });
    const err = await svc.claim('u1', 'X').catch((e: Error) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain(msg);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('tài khoản khách vãng lai (chưa SĐT, chưa Zalo thật) → đòi đăng nhập Zalo, không ghi', async () => {
    const { svc, createMany } = make({ user: GUEST });
    await expect(svc.claim('u1', 'SHOPEE-AB12CD34')).rejects.toThrow(REAL_USER_REQUIRED_MSG);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('mã chỉ khách mới + khách đã có đơn → từ chối và KHÔNG giữ chỗ của thẻ (để người khác còn nhận)', async () => {
    const { svc, createMany } = make({ priorOrder: true });
    await expect(svc.claim('u1', 'SHOPEE-AB12CD34')).rejects.toThrow(NEW_CUSTOMER_ONLY_MSG);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('khách đã dùng hết lượt của mã → báo đã dùng', async () => {
    const { svc } = make({ claimed: true, used: 1 });
    await expect(svc.claim('u1', 'SHOPEE-AB12CD34')).rejects.toThrow('Bạn đã dùng mã ưu đãi này rồi.');
  });

  it('mã công khai đủ điều kiện → trả thông tin, không ghi dòng nhận (mã đã sẵn trong ví)', async () => {
    const { svc, createMany } = make({ coupon: coupon({ scope: 'PUBLIC', newCustomerOnly: false }) });
    await expect(svc.claim('u1', 'SHOPEE-AB12CD34')).resolves.toMatchObject({ alreadyClaimed: false });
    expect(createMany).not.toHaveBeenCalled();
  });

  it('mã cá nhân của người khác → từ chối', async () => {
    const { svc } = make({ coupon: coupon({ scope: 'USER_GROUP', scopeMeta: { userId: 'other' } }) });
    await expect(svc.claim('u1', 'SHOPEE-AB12CD34')).rejects.toThrow('Mã không áp dụng cho tài khoản này.');
  });
});

describe('CouponClaimService.claimHiddenForCart (gõ mã thẻ ở giỏ)', () => {
  it('mã CLAIM chưa nhận → nhận luôn', async () => {
    const { svc, createMany } = make();
    await svc.claimHiddenForCart('u1', 'SHOPEE-AB12CD34');
    expect(createMany).toHaveBeenCalled();
  });

  it('mã CLAIM đã nhận → không làm gì', async () => {
    const { svc, createMany, transaction } = make({ claimed: true });
    await svc.claimHiddenForCart('u1', 'SHOPEE-AB12CD34');
    expect(transaction).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('mã khác CLAIM hoặc không tồn tại → không làm gì (giỏ tự báo lỗi của mã như trước)', async () => {
    for (const c of [coupon({ scope: 'PUBLIC' }), null]) {
      const { svc, createMany } = make({ coupon: c });
      await expect(svc.claimHiddenForCart('u1', 'X')).resolves.toBeUndefined();
      expect(createMany).not.toHaveBeenCalled();
    }
  });
});
