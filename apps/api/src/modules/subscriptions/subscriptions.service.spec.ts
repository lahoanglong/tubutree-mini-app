import { SubscriptionsService } from './subscriptions.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { PricingService } from '../pricing/pricing.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { NotificationsService } from '../notifications/notifications.service';

const config = {} as unknown as SystemConfigService;
const pricing = {} as unknown as PricingService;
const loyalty = {} as unknown as LoyaltyService;
const notifications = {} as unknown as NotificationsService;

function makeService(opts: { variation?: unknown; address?: unknown; create?: jest.Mock } = {}) {
  const create = opts.create ?? jest.fn().mockImplementation((args) => Promise.resolve({ id: 's1', ...args.data }));
  const prisma = {
    variation: { findUnique: jest.fn().mockResolvedValue(opts.variation ?? { id: 'v1', isActive: true }) },
    address: { findUnique: jest.fn().mockResolvedValue(opts.address ?? { id: 'a1', userId: 'u1' }) },
    subscription: { create },
  } as unknown as PrismaService;
  return { svc: new SubscriptionsService(prisma, config, pricing, loyalty, notifications), create };
}

const dto = (over = {}) => ({ variationId: 'v1', quantity: 2, intervalWeeks: 4, addressId: 'a1', ...over });

describe('SubscriptionsService.create', () => {
  it('từ chối chu kỳ không hợp lệ (5 tuần)', async () => {
    const { svc } = makeService();
    await expect(svc.create('u1', dto({ intervalWeeks: 5 }))).rejects.toThrow('4/6/8/10');
  });

  it('từ chối sản phẩm ngừng bán', async () => {
    const { svc } = makeService({ variation: { id: 'v1', isActive: false } });
    await expect(svc.create('u1', dto())).rejects.toThrow('không khả dụng');
  });

  it('từ chối địa chỉ của người khác', async () => {
    const { svc } = makeService({ address: { id: 'a1', userId: 'other' } });
    await expect(svc.create('u1', dto())).rejects.toThrow('Địa chỉ không hợp lệ');
  });

  it('tạo lịch ACTIVE với nextRunAt ≈ +intervalWeeks', async () => {
    const { svc, create } = makeService();
    await svc.create('u1', dto({ intervalWeeks: 6 }));
    const data = create.mock.calls[0][0].data;
    const days = (new Date(data.nextRunAt).getTime() - Date.now()) / 864e5;
    expect(days).toBeGreaterThan(6 * 7 - 1);
    expect(days).toBeLessThan(6 * 7 + 1);
    expect(data.quantity).toBe(2);
    expect(data.intervalWeeks).toBe(6);
  });
});

describe('SubscriptionsService.processDue (claim chống double-order)', () => {
  function makeProcess(claimCount: number) {
    const due = [{ id: 's1', userId: 'u1', variationId: 'v1', quantity: 1, addressId: 'a1', intervalWeeks: 4 }];
    const updateMany = jest.fn().mockResolvedValue({ count: claimCount });
    const orderCreate = jest.fn().mockResolvedValue({ id: 'o1' });
    const prisma = {
      subscription: {
        findMany: jest.fn().mockResolvedValue(due),
        updateMany,
        update: jest.fn().mockResolvedValue({}),
      },
      variation: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', isActive: true, salePrice: null, retailPrice: 100000, name: 'V', product: { name: 'P' } }) },
      address: { findUnique: jest.fn().mockResolvedValue({ id: 'a1', userId: 'u1', recipient: 'R', phone: '09', province: 'p', district: 'd', ward: 'w', street: 's', provinceCode: '1', districtCode: '2', wardCode: '3' }) },
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', tierId: null }) },
      order: { create: orderCreate, findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const cfg = { get: async <T>(_k: string, fb?: T) => fb as T } as unknown as SystemConfigService;
    const pr = {
      calcShippingFee: jest.fn().mockResolvedValue(0),
      calcPointsEarned: jest.fn().mockResolvedValue(0),
    } as unknown as PricingService;
    const ly = { getTierMultiplier: jest.fn().mockResolvedValue(1) } as unknown as LoyaltyService;
    const nt = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
    return { svc: new SubscriptionsService(prisma, cfg, pr, ly, nt), updateMany, orderCreate };
  }

  it('claim thành công (count=1) → tạo đơn định kỳ', async () => {
    const { svc, updateMany, orderCreate } = makeProcess(1);
    await svc.processDue();
    // claim advance nextRunAt với điều kiện status ACTIVE + đến hạn
    expect(updateMany.mock.calls[0][0].where).toMatchObject({ id: 's1', status: 'ACTIVE' });
    expect(orderCreate).toHaveBeenCalledTimes(1);
  });

  it('instance khác đã claim (count=0) → KHÔNG tạo đơn trùng', async () => {
    const { svc, orderCreate } = makeProcess(0);
    await svc.processDue();
    expect(orderCreate).not.toHaveBeenCalled();
  });
});
