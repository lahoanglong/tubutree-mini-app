import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { GroupBuyService } from '../../src/modules/groupbuy/groupbuy.service';
import { createUser, pinConfig, randCode, warmPool } from './helpers';

/**
 * D4-04: trần "groupbuy.max_open_per_user" đếm nhóm OPEN rồi mới tạo; không có khoá thì N yêu cầu song song của cùng một
 * khách cùng đọc "chưa đủ" và tạo vượt trần.
 */
describe('Trần số nhóm mua chung đang mở mỗi khách (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let groupBuy: GroupBuyService;
  let restoreConfig: () => Promise<void>;
  const tag = randCode(6).toLowerCase();
  const MAX_OPEN = 3;
  let productId = '';
  let userId = '';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService, GroupBuyService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    restoreConfig = await pinConfig(prisma, 'groupbuy.max_open_per_user', MAX_OPEN);
    groupBuy = moduleRef.get(GroupBuyService);
    const product = await prisma.product.create({
      data: { brand: 'IT Brand', slug: `it-gbmax-${tag}`, name: `Nước rửa chén IT ${tag}`, description: 'IT', basePrice: 100_000, approvalStatus: 'APPROVED' },
    });
    productId = product.id;
    userId = (await createUser(prisma, { phone: `09${Math.floor(10_000_000 + Math.random() * 89_999_999)}` })).id;
  });

  afterAll(async () => {
    await prisma.groupBuy.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await restoreConfig?.();
    await moduleRef?.close();
  });

  it('10 yêu cầu tạo nhóm song song của một khách → đúng max_open_per_user nhóm OPEN, phần còn lại bị từ chối', async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => groupBuy.create(userId, productId)));

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(MAX_OPEN);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(10 - MAX_OPEN);
    expect(await prisma.groupBuy.count({ where: { initiatorId: userId, status: 'OPEN' } })).toBe(MAX_OPEN);
  });
});
