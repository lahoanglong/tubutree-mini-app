import type { Prisma } from '@prisma/client';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { linkTubuFulfilledVariation, unlinkTubuFulfilledVariation } from '../../src/modules/merchant/merchant-pancake-link';
import { createUser, randCode, sleep, warmPool } from './helpers';

/**
 * Admin từ chối sản phẩm đối tác đang chờ duyệt (lật PENDING_REVIEW rồi gỡ liên kết trong cùng tx) ‖ admin gỡ liên kết của
 * chính sản phẩm đó. Cả hai chạy `unlinkTubuFulfilledVariation`; từ chối đã giữ dòng sản phẩm (CAS duyệt) trước khi chạm biến
 * thể, nên gỡ liên kết cũng phải khoá sản phẩm trước biến thể (không thì 40P01).
 */
describe('Từ chối sản phẩm ‖ admin gỡ liên kết (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  async function setup() {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({ data: { type: 'MERCHANT', slug: `rl-${tag}`, title: `S ${tag}`, ownerUserId: owner.id } });
    const origin = await prisma.product.create({
      data: { pancakeId: `rl-o-${tag}`, brand: 'IT', slug: `rl-o-${tag}`, name: `Gốc ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    const own = await prisma.product.create({
      data: {
        storefrontId: store.id,
        fulfilment: 'TUBU',
        approvalStatus: 'PENDING_REVIEW',
        pancakeLinkCode: `rl-v-${tag}`,
        brand: 'IT',
        slug: `rl-p-${tag}`,
        name: `SP ${tag}`,
        description: 'IT',
        basePrice: 100_000,
      },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `rl-v-${tag}`, productId: own.id, sku: `RL-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, stock: 5 },
    });
    const link = await prisma.merchantPancakeLink.create({
      data: { productId: own.id, storefrontId: store.id, variationId: v.id, originProductId: origin.id, linkedAt: new Date(Date.now() - 3_600_000) },
    });
    return { admin, store, origin, own, v, link };
  }

  const blockedBy = async (pid: number) => {
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids("pid"))`;
    return Number(n);
  };
  const pidOf = async (tx: Prisma.TransactionClient) => (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;

  /**
   * Ép đúng xen kẽ: từ chối giữ dòng sản phẩm rồi chờ lần gỡ của admin tới được bước đóng mốc liên kết (mã cũ: đã giữ biến thể);
   * lúc đó admin chờ từ chối chạm biến thể rồi mới đi tiếp. Mã mới: admin kẹt ở khoá sản phẩm nên không bao giờ tới bước đó, bên
   * từ chối hết giờ chờ (mềm) và chạy xong trước.
   */
  async function race() {
    const s = await setup();
    let adminAtClose!: () => void;
    const adminAtCloseP = new Promise<void>((r) => (adminAtClose = r));
    let adminPid = 0;
    let rejectLocked!: () => void;
    const rejectLockedP = new Promise<void>((r) => (rejectLocked = r));

    const reject = prisma.$transaction(
      async (tx) => {
        const moved = await tx.product.updateMany({
          where: { id: s.own.id, approvalStatus: 'PENDING_REVIEW' },
          data: { approvalStatus: 'REJECTED', rejectReason: 'IT' },
        });
        expect(moved.count).toBe(1);
        rejectLocked();
        await Promise.race([adminAtCloseP, sleep(1_500)]);
        await unlinkTubuFulfilledVariation(tx, s.own.id, { actorId: s.admin.id, reason: 'reject', deactivate: false });
      },
      { timeout: 30_000 },
    );
    reject.catch(() => rejectLocked());
    await rejectLockedP;

    const unlink = prisma.$transaction(
      async (tx) => {
        adminPid = await pidOf(tx);
        const proxied = new Proxy(tx, {
          get(target, prop, receiver) {
            if (prop !== 'merchantPancakeLink') return Reflect.get(target, prop, receiver);
            return new Proxy(target.merchantPancakeLink, {
              get(t, m) {
                if (m !== 'updateMany') return Reflect.get(t, m);
                return async (...args: Parameters<typeof t.updateMany>) => {
                  adminAtClose();
                  for (let i = 0; i < 80 && (await blockedBy(adminPid)) === 0; i++) await sleep(25);
                  return t.updateMany(...args);
                };
              },
            });
          },
        }) as Prisma.TransactionClient;
        return unlinkTubuFulfilledVariation(proxied, s.own.id, { actorId: s.admin.id, reason: 'admin', deactivate: true, legacy: 'throw' });
      },
      { timeout: 30_000 },
    );
    const results = await Promise.allSettled([reject, unlink]);
    return { s, results };
  }

  it('từ chối ‖ gỡ liên kết: không deadlock, liên kết đóng đúng một lần, biến thể về sản phẩm gốc', async () => {
    const { s, results } = await race();
    const codes = results.map((r) => (r.status === 'rejected' ? String((r.reason as { meta?: { code?: string }; message?: string }).meta?.code ?? (r.reason as Error).message) : 'ok'));
    expect(codes.some((c) => /40P01|deadlock/i.test(c))).toBe(false);
    // Từ chối thắng khoá sản phẩm nên chạy xong; lần gỡ của admin thấy liên kết đã đóng và không còn gì để gỡ (hoặc cũng xong).
    expect(results[0]!.status).toBe('fulfilled');
    const link = await prisma.merchantPancakeLink.findUniqueOrThrow({ where: { id: s.link.id } });
    expect(link.unlinkedAt).not.toBeNull();
    expect((await prisma.variation.findUniqueOrThrow({ where: { id: s.v.id } })).productId).toBe(s.origin.id);
    const own = await prisma.product.findUniqueOrThrow({ where: { id: s.own.id } });
    expect(own).toMatchObject({ approvalStatus: 'REJECTED', fulfilment: 'MERCHANT' });
  });

  it('đường duyệt (liên kết) vẫn khoá sản phẩm rồi biến thể: liên kết một sản phẩm chờ duyệt xong bình thường', async () => {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({ data: { type: 'MERCHANT', slug: `rl2-${tag}`, title: `S ${tag}`, ownerUserId: owner.id } });
    const origin = await prisma.product.create({
      data: { pancakeId: `rl2-o-${tag}`, brand: 'IT', slug: `rl2-o-${tag}`, name: `Gốc ${tag}`, description: 'IT', basePrice: 100_000, isActive: true },
    });
    await prisma.variation.create({
      data: { pancakeId: `rl2-v-${tag}`, productId: origin.id, sku: `RL2-${tag}`, name: 'M', attributes: {}, retailPrice: 100_000, stock: 5 },
    });
    const own = await prisma.product.create({
      data: { storefrontId: store.id, pancakeLinkCode: `rl2-v-${tag}`, approvalStatus: 'PENDING_REVIEW', brand: 'IT', slug: `rl2-p-${tag}`, name: `SP ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    const linked = await prisma.$transaction((tx) => linkTubuFulfilledVariation(tx, own, { adminId: admin.id, confirmTakeover: true }));
    expect(linked?.originProductId).toBe(origin.id);
  });
});
