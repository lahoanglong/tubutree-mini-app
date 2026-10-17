import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { createUser, randCode, warmPool } from './helpers';

/**
 * Tổng quan admin liệt kê MỌI gian hàng đối tác (MERCHANT hoặc isPartner): gian hàng xếp cuối theo tên không bị cắt bởi giới hạn số dòng.
 */
describe('adminOverview không cắt gian hàng đối tác ở cuối danh sách (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let fulfilment: MerchantFulfilmentService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        MerchantFulfilmentService,
        { provide: OrderStatusService, useValue: {} },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    fulfilment = moduleRef.get(MerchantFulfilmentService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('hơn 200 gian hàng đối tác: gian hàng bật cờ xếp cuối theo tên vẫn hiện', async () => {
    const tag = randCode(6).toLowerCase();
    await prisma.storefront.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        type: 'MERCHANT' as const,
        slug: `itov-${tag}-${String(i).padStart(3, '0')}`,
        title: `AA ${tag} ${String(i).padStart(3, '0')}`,
        ownerUserId: null,
        isPartner: true,
        isPublished: true,
      })),
    });
    const flaggedOwner = await createUser(prisma, { role: 'AFFILIATE' });
    const last = await prisma.storefront.create({
      data: { type: 'CTV', slug: `itov-${tag}-last`, title: `ZZZ ${tag} cuối`, ownerUserId: flaggedOwner.id, isPartner: true, isPublished: true },
    });

    const res = await fulfilment.adminOverview();
    const ids = res.stores.map((s) => s.storefrontId);
    expect(ids).toContain(last.id);
    expect(ids.length).toBeGreaterThanOrEqual(206);
  });
});
