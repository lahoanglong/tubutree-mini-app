import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import { AffiliateService } from './affiliate.service';
import { canPlaceOrderForCustomer, canRegisterAsAffiliate, hasAffiliateAccess } from './affiliate-access';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { PricingService } from '../pricing/pricing.service';
import type { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import type { RewardPointsService } from '../wallet/reward-points.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';

const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
const pricing = { calcShippingFee: jest.fn().mockResolvedValue(0) } as unknown as PricingService;
const pancakeOrder = { enqueuePush: jest.fn() } as unknown as PancakeOrderService;
const rewards = { grant: jest.fn() } as unknown as RewardPointsService;
const analytics = { record: jest.fn(), recordBestEffort: jest.fn() } as unknown as AnalyticsEventsService;

function db(opts: { storefront?: boolean; commission?: boolean } = {}) {
  return {
    storefront: { findFirst: jest.fn().mockResolvedValue(opts.storefront ? { id: 's1' } : null) },
    commission: { findFirst: jest.fn().mockResolvedValue(opts.commission ? { id: 'c1' } : null) },
  };
}

describe('hasAffiliateAccess (D3-03: CTV lên đại lý không mất màn hoa hồng)', () => {
  it.each<UserRole>(['AFFILIATE', 'ADMIN'])('%s luôn có, không cần tra gian hàng hay hoa hồng', async (role) => {
    const d = db();
    expect(await hasAffiliateAccess(d as never, { id: 'u1', role })).toBe(true);
    expect(d.storefront.findFirst).not.toHaveBeenCalled();
    expect(d.commission.findFirst).not.toHaveBeenCalled();
  });

  it.each<UserRole>(['CUSTOMER', 'STAFF'])('%s không có, kể cả khi còn dữ liệu cũ', async (role) => {
    const d = db({ storefront: true, commission: true });
    expect(await hasAffiliateAccess(d as never, { id: 'u1', role })).toBe(false);
  });

  it('đại lý có gian hàng CTV → có', async () => {
    const d = db({ storefront: true });
    expect(await hasAffiliateAccess(d as never, { id: 'u1', role: 'DEALER' })).toBe(true);
    expect(d.storefront.findFirst).toHaveBeenCalledWith({ where: { ownerUserId: 'u1', type: 'CTV' }, select: { id: true } });
  });

  it('đại lý chưa có gian hàng CTV nhưng có dòng hoa hồng (kể cả đã trả/từ chối) → có, để xem sổ và rút phần còn lại', async () => {
    const d = db({ commission: true });
    expect(await hasAffiliateAccess(d as never, { id: 'u1', role: 'DEALER' })).toBe(true);
    expect(d.commission.findFirst).toHaveBeenCalledWith({ where: { affiliateUserId: 'u1' }, select: { id: true } });
  });

  it('đại lý thuần (không gian hàng CTV, không hoa hồng) → không', async () => {
    expect(await hasAffiliateAccess(db() as never, { id: 'u1', role: 'DEALER' })).toBe(false);
  });
});

describe('canRegisterAsAffiliate / canPlaceOrderForCustomer', () => {
  it.each<[UserRole, boolean, boolean]>([
    ['CUSTOMER', true, false],
    ['AFFILIATE', true, true],
    ['DEALER', false, false],
    ['STAFF', false, false],
    ['ADMIN', false, true],
  ])('%s: đăng ký CTV=%s, lên đơn hộ=%s', (role, register, order) => {
    expect(canRegisterAsAffiliate(role)).toBe(register);
    expect(canPlaceOrderForCustomer(role)).toBe(order);
  });
});

describe('AffiliateService.getMe cho đại lý', () => {
  function service(user: Record<string, unknown>, opts: { storefront?: boolean; commission?: boolean } = {}) {
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', referralCode: 'TUBU88', walletBalance: 5000, personalTaxId: null, ...user }) },
      commission: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { commissionableTotal: 0 } }),
        findFirst: jest.fn().mockResolvedValue(opts.commission ? { id: 'c1' } : null),
      },
      storefront: { findFirst: jest.fn().mockResolvedValue(opts.storefront ? { id: 's1' } : null) },
    } as unknown as PrismaService;
    return new AffiliateService(prisma, config, pricing, pancakeOrder, rewards, analytics);
  }

  it('đại lý có gian hàng CTV: isAffiliate=true, vẫn thấy mã giới thiệu và số dư ví; không đăng ký lại, không lên đơn hộ', async () => {
    const me = await service({ role: 'DEALER' }, { storefront: true }).getMe('u1');
    expect(me).toMatchObject({
      isAffiliate: true,
      referralCode: 'TUBU88',
      walletBalance: 5000,
      canRegister: false,
      canOrderForCustomer: false,
    });
  });

  it('đại lý chỉ có hoa hồng: isAffiliate=true', async () => {
    expect((await service({ role: 'DEALER' }, { commission: true }).getMe('u1')).isAffiliate).toBe(true);
  });

  it('đại lý thuần: isAffiliate=false và canRegister=false để miniapp không đưa màn đăng ký ngõ cụt', async () => {
    expect(await service({ role: 'DEALER' }).getMe('u1')).toMatchObject({ isAffiliate: false, canRegister: false });
  });

  it('CTV: isAffiliate, canRegister, canOrderForCustomer đều true; khách thường chỉ canRegister', async () => {
    expect(await service({ role: 'AFFILIATE' }).getMe('u1')).toMatchObject({ isAffiliate: true, canRegister: true, canOrderForCustomer: true });
    expect(await service({ role: 'CUSTOMER' }).getMe('u1')).toMatchObject({ isAffiliate: false, canRegister: true, canOrderForCustomer: false });
  });
});

describe('AffiliateService lên đơn hộ: đại lý vẫn bị chặn (Q1 dealer bán lẻ chưa chốt)', () => {
  const prisma = {
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'd1', role: 'DEALER', phone: '0911111111' }) },
  } as unknown as PrismaService;
  const svc = new AffiliateService(prisma, config, pricing, pancakeOrder, rewards, analytics);

  it('quote và place đều từ chối đại lý dù có gian hàng CTV và hoa hồng', async () => {
    const items = [{ variationId: 'v1', quantity: 1 }];
    await expect(svc.quoteOrderForCustomer('d1', { items } as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.placeOrderForCustomer('d1', { items } as never)).rejects.toThrow('Chỉ CTV mới có thể lên đơn hộ khách.');
  });
});
