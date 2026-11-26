import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CheckoutService } from '../../src/modules/checkout/checkout.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { GomdonOrderService } from '../../src/modules/integrations/gomdon/gomdon-order.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { ComboService } from '../../src/modules/storefront/combo.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { GameService } from '../../src/modules/game/game.service';
import { createUser, randCode } from './helpers';

/**
 * Dựng chung cho các race spec W42 (lô MARKETPLACE): CheckoutService, OrdersService (huỷ), OrderReversalService, LoyaltyService, GameService
 * là bản thật; chỉ stub thông báo / Pancake / Gomdon / combo / flash sale / coupon như pd3-checkout-points.race-spec.
 */
export async function w42Module(): Promise<TestingModule> {
  const moduleRef = await Test.createTestingModule({
    imports: [PrismaModule],
    providers: [
      SystemConfigService,
      AnalyticsEventsService,
      CartService,
      CheckoutService,
      PricingService,
      LoyaltyService,
      GameService,
      AffiliateService,
      RewardPointsService,
      WalletService,
      CashbackService,
      OrderReversalService,
      OrdersService,
      DealerService,
      { provide: CouponsService, useValue: { validateAndCompute: jest.fn(), redeem: jest.fn(), release: jest.fn().mockResolvedValue(undefined) } },
      { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) } },
      { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      { provide: GomdonOrderService, useValue: { isRecyclingEnabled: jest.fn().mockResolvedValue(false), enqueuePush: jest.fn() } },
      {
        provide: ComboService,
        useValue: {
          computeForStorefront: jest.fn().mockResolvedValue({ total: 0, perLine: {} }),
          computeWithGroups: jest.fn().mockResolvedValue({ total: 0, perLine: {}, groups: [] }),
        },
      },
      {
        provide: FlashSaleService,
        useValue: { resolveEffective: jest.fn().mockResolvedValue(new Map()), consumeQuota: jest.fn(), restore: jest.fn().mockResolvedValue(undefined) },
      },
      { provide: CashbackProviderRegistry, useValue: { all: () => [] } },
    ],
  }).compile();
  await moduleRef.init();
  return moduleRef;
}

export interface Lots {
  standard?: number;
  converted?: number;
  marketplace?: number;
}

/** Hạn của dòng mở đầu lô có hạn: đủ xa để cron hết hạn không chạm (ca hết hạn tự dời mốc). */
export const SEED_EXPIRES_AT = () => new Date(Date.now() + 180 * 864e5);

/** Khách có số dư từng lô khớp sổ (mỗi lô một dòng mở đầu; lô có hạn mang expiresAt như dòng cộng thật). */
export async function userWithLots(prisma: PrismaService, lots: Lots, touched: string[]) {
  const standard = lots.standard ?? 0;
  const converted = lots.converted ?? 0;
  const marketplace = lots.marketplace ?? 0;
  const u = await createUser(prisma, { pointsBalance: standard, pointsConvertedBalance: converted, pointsMarketplaceBalance: marketplace });
  touched.push(u.id);
  const rows = [
    { lot: 'STANDARD' as const, delta: standard, expiresAt: SEED_EXPIRES_AT() },
    { lot: 'CONVERTED' as const, delta: converted, expiresAt: null },
    { lot: 'MARKETPLACE' as const, delta: marketplace, expiresAt: SEED_EXPIRES_AT() },
  ].filter((r) => r.delta !== 0);
  if (rows.length > 0) {
    await prisma.pointsTransaction.createMany({
      data: rows.map((r) => ({ userId: u.id, delta: r.delta, lot: r.lot, reason: `IT_SEED_${r.lot}`, refType: 'IT', expiresAt: r.expiresAt })),
    });
  }
  return u;
}

/** Địa chỉ + `lines` sản phẩm 100.000đ (mỗi sản phẩm một dòng giỏ, tồn kho dư). Trả id các dòng giỏ để mỗi lần đặt một dòng riêng. */
export async function cartWithLines(prisma: PrismaService, cart: CartService, userId: string, lines = 1) {
  const addr = await prisma.address.create({
    data: {
      userId,
      recipient: 'Khach IT',
      phone: `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`,
      province: 'Ha Noi',
      district: '',
      ward: 'Phuong IT',
      street: '1 Duong IT',
      provinceCode: '84_VN01',
      districtCode: '',
      wardCode: '00001',
    },
  });
  for (let i = 0; i < lines; i++) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itw42-p-${tag}`, brand: 'IT', slug: `itw42-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `itw42-v-${tag}`, productId: product.id, sku: `ITW42-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, stock: 50 },
    });
    await cart.addItem(userId, { variationId: v.id, quantity: 1 });
  }
  const lineIds = (await prisma.cartItem.findMany({ where: { cart: { userId } }, select: { id: true } })).map((l) => l.id);
  return { addr, lineIds };
}

/** Mọi lời gọi placeOrder đọc giỏ (compute) xong rồi mới cùng đi tiếp vào tx: kiểm guard trừ điểm trong tx, không phải lỗi giỏ trống. */
export function barrierOnGetCart(cart: CartService, n: number) {
  const original = cart.getCartForCheckout.bind(cart);
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return jest.spyOn(cart, 'getCartForCheckout').mockImplementation(async (userId: string) => {
    const res = await original(userId);
    if (++arrived === n) release();
    await gate;
    return res;
  });
}

export async function lotsOf(prisma: PrismaService, userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { pointsBalance: true, pointsConvertedBalance: true, pointsMarketplaceBalance: true },
  });
}
