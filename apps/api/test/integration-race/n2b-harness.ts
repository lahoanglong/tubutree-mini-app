import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { OrderStatus, Prisma } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { MerchantService } from '../../src/modules/merchant/merchant.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { createOrder, createUser, deleteItData, randCode, setConfig, sleep, warmPool } from './helpers';

const CONFIG_KEYS = ['merchant.settlement_hold_days', 'merchant.consignment_settle_from'];

/** Dựng AdminService/RbacService/MerchantService thật trên Postgres thật cho các spec vai trò ↔ gian hàng đối tác (nhóm n2b). */
export async function partnerHarness() {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [PrismaModule],
    providers: [SystemConfigService],
  }).compile();
  await moduleRef.init();
  const prisma = moduleRef.get(PrismaService);
  await warmPool(prisma);
  const savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
  await setConfig(prisma, 'merchant.settlement_hold_days', 7);
  await setConfig(prisma, 'merchant.consignment_settle_from', '2000-01-01T00:00:00Z');
  const fulfilment = new MerchantFulfilmentService(prisma, {} as never, undefined, moduleRef.get(SystemConfigService));
  const none = {} as never;
  const rbac = new RbacService(prisma, fulfilment);
  const admin = new AdminService(prisma, none, none, none, none, none, none, rbac, none, none, fulfilment);
  const portal = new MerchantService(prisma, none);
  const created = { userIds: [] as string[], productIds: [] as string[], storefrontIds: [] as string[], tierIds: [] as string[] };

  async function cleanup() {
    const { userIds, storefrontIds } = created;
    const owned = await prisma.product.findMany({ where: { storefrontId: { in: storefrontIds } }, select: { id: true } });
    created.productIds.push(...owned.map((p) => p.id));
    await prisma.storefrontItem.deleteMany({ where: { collection: { storefrontId: { in: storefrontIds } } } });
    await prisma.merchantPayout.deleteMany({ where: { storefrontId: { in: storefrontIds } } });
    await prisma.merchantPancakeLink.deleteMany({ where: { storefrontId: { in: storefrontIds } } });
    await prisma.userAdminEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.roleGrant.deleteMany({ where: { grantedBy: { in: userIds } } });
    await prisma.dealerApplication.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.accountDeletionRequest.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.storefront.updateMany({ where: { id: { in: storefrontIds } }, data: { ownerUserId: null } });
    await deleteItData(prisma, created);
    await prisma.storefront.deleteMany({ where: { id: { in: storefrontIds } } });
    await prisma.dealerTier.deleteMany({ where: { id: { in: created.tierIds } } });
    await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
    for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
    await moduleRef.close();
  }

  const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  async function user(role: 'ADMIN' | 'DEALER' | 'CUSTOMER' | 'AFFILIATE' | 'STAFF', extra: Partial<Prisma.UserUncheckedCreateInput> = {}) {
    const u = await createUser(prisma, { role, phone: phone(), ...extra });
    created.userIds.push(u.id);
    return u;
  }
  async function tier() {
    const t = await prisma.dealerTier.create({ data: { id: `tier_${randCode(8)}`, name: 'Bậc IT', minOrderVolume: 0, discountRules: {} } });
    created.tierIds.push(t.id);
    return t;
  }

  /** Chủ + gian hàng (mặc định MERCHANT, isPartner) + admin + người mua. */
  async function ownerStore(o: { role?: 'DEALER' | 'STAFF' | 'ADMIN' | 'CUSTOMER' | 'AFFILIATE'; type?: 'CTV' | 'MERCHANT'; isPartner?: boolean } = {}) {
    const adminUser = await user('ADMIN');
    const owner = await user(o.role ?? 'DEALER');
    const buyer = await user('CUSTOMER');
    const tag = randCode(8).toLowerCase();
    const sf = await prisma.storefront.create({
      data: { type: o.type ?? 'MERCHANT', isPartner: o.isPartner ?? true, slug: `n2b-${tag}`, subdomain: `n2b-${tag}`, ownerUserId: owner.id, title: `Shop ${tag}`, isPublished: true },
    });
    created.storefrontIds.push(sf.id);
    const store = () => prisma.storefront.findUniqueOrThrow({ where: { id: sf.id } });
    const partnerEvents = () => prisma.userAdminEvent.findMany({ where: { userId: owner.id, kind: 'STOREFRONT_PARTNER' }, orderBy: { createdAt: 'asc' } });
    const roleOf = async () => (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).role;
    const selfShip = (status: OrderStatus, extra: Partial<Prisma.OrderUncheckedCreateInput> = {}) =>
      createOrder(prisma, { userId: buyer.id, status, fulfiller: 'MERCHANT', fulfillerStorefrontId: sf.id, storefrontSlug: sf.slug, paymentStatus: 'UNPAID', paymentMethod: 'COD', ...extra });
    return { adminUser, owner, buyer, sf, store, partnerEvents, roleOf, selfShip };
  }

  async function product(storefrontId: string, o: { fulfilment?: 'MERCHANT' | 'TUBU'; isActive?: boolean } = {}) {
    const p = await prisma.product.create({
      data: {
        storefrontId, fulfilment: o.fulfilment ?? 'MERCHANT', isActive: o.isActive ?? true, brand: 'IT', slug: `n2b-${randCode(8).toLowerCase()}`, name: 'SP IT', description: 'IT', basePrice: 1000,
        variations: { create: [{ sku: `N2B-${randCode(8)}`, pancakeId: `n2b-${randCode(8)}`, name: 'v', attributes: {}, retailPrice: 1000, stock: 5 }] },
      },
    });
    created.productIds.push(p.id);
    return p;
  }

  /** Giữ một khoá do `lock` lấy cho tới khi gọi release (cùng cách các spec d2). */
  async function hold(lock: (tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0]) => Promise<unknown>) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    let pid = 0;
    const done = prisma.$transaction(
      async (tx) => {
        await lock(tx);
        [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS "pid"`;
        locked();
        await gate;
      },
      { timeout: 30_000 },
    );
    await held;
    return { release, done, pid };
  }

  /** Số phiên đang chờ (kể cả gián tiếp) khoá của phiên `holderPid`. */
  async function lockWaiters(holderPid: number) {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`
      WITH RECURSIVE "w" AS (
        SELECT "pid" FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids("pid"))
        UNION
        SELECT a."pid" FROM pg_stat_activity a JOIN "w" ON "w"."pid" = ANY(pg_blocking_pids(a."pid"))
      )
      SELECT count(*)::int AS "n" FROM "w"`;
    return row?.n ?? 0;
  }

  async function waitUntil(cond: () => Promise<boolean> | boolean, what: string) {
    for (let i = 0; !(await cond()); i++) {
      if (i > 200) throw new Error(`${what} không tới chỗ chờ khoá`);
      await sleep(25);
    }
  }

  const address = (userId: string) =>
    prisma.address.create({
      data: { userId, recipient: 'IT', phone: phone(), province: 'Ha Noi', district: '', ward: 'P', street: '1', provinceCode: '84_VN01', districtCode: '', wardCode: '00001' },
    });

  return { prisma, moduleRef, admin, rbac, portal, fulfilment, created, cleanup, user, tier, ownerStore, product, hold, lockWaiters, waitUntil, address };
}
