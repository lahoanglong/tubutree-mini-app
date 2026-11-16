import 'reflect-metadata';
import { GUARDS_METADATA, HEADERS_METADATA } from '@nestjs/common/constants';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import type { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { CheckoutController } from './checkout.controller';
import type { CheckoutService } from './checkout.service';
import { ShippingEstimateQueryDto } from './dto/shipping-estimate.dto';
import { ShippingEstimateService } from './shipping-estimate.service';

function build(opts: { config?: Record<string, unknown>; user?: Record<string, unknown> | null; hasOrder?: boolean; home?: { provinceCode: string; province: string } | null } = {}) {
  const values: Record<string, unknown> = {
    'shipping.free_threshold': 199_000,
    'shipping.flat_fee_below_threshold': 19_000,
    'shipping.tier_freeship_overrides': {},
    'shipping.first_order_free_enabled': true,
    'shipping.first_order_free_min_subtotal': 199_000,
    ...opts.config,
  };
  const config = { get: jest.fn(async (key: string, fallback: unknown) => (key in values ? values[key] : fallback)) };
  const prisma = {
    user: {
      findUnique: jest.fn(async () => (opts.user === null ? null : { tierId: null, phone: '0900000000', zaloId: 'z1', ...opts.user })),
    },
    order: { findFirst: jest.fn().mockResolvedValue(opts.hasOrder ? { id: 'o1' } : null), count: jest.fn().mockResolvedValue(opts.hasOrder ? 1 : 0) },
    address: { findFirst: jest.fn().mockResolvedValue(opts.home ?? null) },
  };
  const svc = new ShippingEstimateService(
    prisma as unknown as PrismaService,
    config as unknown as SystemConfigService,
    new PricingService(config as unknown as SystemConfigService),
  );
  return { svc, prisma, config };
}

describe('ShippingEstimateService', () => {
  it('ẩn danh: luật chung, không đọc khách hay địa chỉ nào', async () => {
    const { svc, prisma } = build();
    await expect(svc.estimate(undefined, { subtotal: 100_000 })).resolves.toEqual({
      fee: 19_000,
      feeMin: 19_000,
      feeMax: 19_000,
      freeshipThreshold: 199_000,
      missingForFreeship: 99_000,
      isEstimate: true,
      provinceCode: null,
      provinceName: null,
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.address.findFirst).not.toHaveBeenCalled();
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
  });

  it('ẩn danh đạt ngưỡng: 0đ, không còn thiếu', async () => {
    const { svc } = build();
    const r = await svc.estimate(undefined, { subtotal: 199_000, provinceCode: '84_VN79' });
    expect(r).toMatchObject({ fee: 0, missingForFreeship: 0, provinceCode: '84_VN79', provinceName: null });
  });

  it('đã đăng nhập, không gửi tỉnh: lấy tỉnh của địa chỉ mặc định của chính khách', async () => {
    const { svc, prisma } = build({ hasOrder: true, home: { provinceCode: '84_VN01', province: 'Hà Nội' } });
    const r = await svc.estimate('u1', { subtotal: 50_000 });
    expect(r).toMatchObject({ fee: 19_000, provinceCode: '84_VN01', provinceName: 'Hà Nội' });
    expect(prisma.address.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', isDefault: true } }));
  });

  it('đã đăng nhập và gửi tỉnh: không đọc sổ địa chỉ, giữ tỉnh khách gửi', async () => {
    const { svc, prisma } = build({ hasOrder: true });
    const r = await svc.estimate('u1', { subtotal: 50_000, provinceCode: '84_VN48' });
    expect(r.provinceCode).toBe('84_VN48');
    expect(r.provinceName).toBeNull();
    expect(prisma.address.findFirst).not.toHaveBeenCalled();
  });

  it('hạng có ngưỡng riêng: miễn phí giao từ ngưỡng của hạng', async () => {
    const { svc } = build({ hasOrder: true, user: { tierId: 'LOC_BIEC' }, config: { 'shipping.tier_freeship_overrides': { LOC_BIEC: 99_000 } } });
    const r = await svc.estimate('u1', { subtotal: 120_000 });
    expect(r).toMatchObject({ fee: 0, freeshipThreshold: 99_000, missingForFreeship: 0 });
  });

  it('đơn đầu của khách thật: ngưỡng đơn đầu thấp hơn thì dùng ngưỡng đó', async () => {
    const { svc } = build({ hasOrder: false, config: { 'shipping.first_order_free_min_subtotal': 150_000 } });
    expect(await svc.estimate('u1', { subtotal: 160_000 })).toMatchObject({ fee: 0, freeshipThreshold: 150_000 });
    expect(await svc.estimate('u1', { subtotal: 100_000 })).toMatchObject({ fee: 19_000, freeshipThreshold: 150_000, missingForFreeship: 50_000 });
  });
});

describe('GET /checkout/shipping-estimate', () => {
  const handler = CheckoutController.prototype.estimateShipping as unknown as object;

  it('công khai, biết khách nếu có phiên, giới hạn tần suất, trình duyệt giữ 5 phút theo phiên', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(OptionalJwtAuthGuard);
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler)).toBe(60);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler)).toBe(60_000);
    const headers = Reflect.getMetadata(HEADERS_METADATA, handler) as { name: string; value: string }[];
    expect(headers.find((h) => h.name === 'Cache-Control')?.value).toBe('private, max-age=300');
    expect(headers.find((h) => h.name === 'Vary')?.value).toBe('Authorization');
  });

  it('chuyển người gọi (hoặc không ai) và đúng tham số sang service', async () => {
    const estimate = jest.fn().mockResolvedValue({ fee: 0 });
    const c = new CheckoutController({} as CheckoutService, { estimate } as unknown as ShippingEstimateService);
    await c.estimateShipping({ subtotal: 1000, provinceCode: '84_VN01' }, undefined);
    await c.estimateShipping({ subtotal: 2000 }, 'u9');
    expect(estimate).toHaveBeenNthCalledWith(1, undefined, { subtotal: 1000, provinceCode: '84_VN01' });
    expect(estimate).toHaveBeenNthCalledWith(2, 'u9', { subtotal: 2000, provinceCode: undefined });
  });

  const check = (q: Record<string, unknown>) => validateSync(plainToInstance(ShippingEstimateQueryDto, q));
  it.each([
    [{ subtotal: '120000' }, true],
    [{ subtotal: '120000', provinceCode: '' }, true],
    [{ subtotal: '120000', provinceCode: '84_VN79' }, true],
    [{}, false],
    [{ subtotal: '-1' }, false],
    [{ subtotal: '1.5' }, false],
    [{ subtotal: 'abc' }, false],
    [{ subtotal: '2000000000' }, false],
    [{ subtotal: '1000', provinceCode: '84 VN; drop' }, false],
  ])('query %j hợp lệ = %s', (q, ok) => {
    expect(check(q).length === 0).toBe(ok);
  });
});
