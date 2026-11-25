import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { readMssEnv } from '../../src/modules/integrations/mss/mss-config';
import { MssClient } from '../../src/modules/integrations/mss/mss.client';
import type { MssHealthService } from '../../src/modules/integrations/mss/mss-health.service';
import { MssCartEventRecorder } from '../../src/modules/integrations/mss/mss-cart-event.recorder';
import { MssCartEventSender } from '../../src/modules/integrations/mss/mss-cart-event.sender';
import { AccountDeletionService } from '../../src/modules/users/account-deletion.service';
import { UsersService } from '../../src/modules/users/users.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { createOrder, createUser, deleteItData, randCode, uniquePhone, warmPool } from './helpers';

const HOUR = 3_600_000;
const DAY = 864e5;

/**
 * Nhắc giỏ bỏ quên qua MSS (w36-01) trên Postgres THẬT: khoá advisory theo khách và đếm 7 ngày giữa hai lượt ghi chồng nhau, hai lượt gửi
 * chồng nhau (SKIP LOCKED) chỉ một POST, ghi `cart.recovered` một lần khi khách mua, dọn dòng quá 30 ngày và xoá dòng khi xoá tài khoản.
 * MSS giả qua fetch tiêm vào MssClient thật (ký HMAC thật); không gọi mạng.
 */
describe('MSS cart events (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const userIds: string[] = [];
  const productIds: string[] = [];
  let variationId: string;

  const env = readMssEnv({
    MSS_BASE_URL: 'https://mss.example.test',
    MSS_KEY_ID: 'k1',
    MSS_OUTBOUND_SECRET: 'o'.repeat(43),
    MSS_INBOUND_SECRET: 'i'.repeat(43),
  } as NodeJS.ProcessEnv);
  const health = { assertCapability: async () => true } as unknown as MssHealthService;

  type FetchReply = { status: number; body?: unknown; delayMs?: number };
  let reply: FetchReply = { status: 202, body: { status: 'queued' } };
  const calls: { url: string; body: string }[] = [];
  const fetchFake = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body ?? '') });
    if (reply.delayMs) await new Promise((res) => setTimeout(res, reply.delayMs));
    return new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  });

  let recorder: MssCartEventRecorder;
  let sender: MssCartEventSender;
  let deletion: AccountDeletionService;
  let users: UsersService;
  let admin: { id: string };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        AccountDeletionService,
        SystemConfigService,
        AnalyticsEventsService,
        RewardPointsService,
        AffiliateService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    deletion = moduleRef.get(AccountDeletionService);
    users = new UsersService(prisma);
    admin = await createUser(prisma, { role: 'ADMIN' });

    const tag = randCode(6);
    const product = await prisma.product.create({
      data: {
        brand: 'IT',
        slug: `itmsscart-${tag}`,
        name: `Nước rửa chén giỏ ${tag}`,
        description: 'IT',
        basePrice: 100_000,
        variations: { create: { sku: `ITMSSC-${tag}`, name: 'Chai', attributes: {}, retailPrice: 100_000, stock: 50 } },
      },
      include: { variations: true },
    });
    productIds.push(product.id);
    variationId = product.variations[0]!.id;

    const client = new MssClient(() => env, fetchFake as never);
    recorder = new MssCartEventRecorder(prisma, health);
    sender = new MssCartEventSender(prisma, client, health);
  });

  beforeEach(() => {
    reply = { status: 202, body: { status: 'queued' } };
    calls.length = 0;
    fetchFake.mockClear();
  });

  afterAll(async () => {
    await prisma.accountDeletionRequest.deleteMany({ where: { userId: { in: userIds } } });
    await deleteItData(prisma, { userIds, productIds });
    await moduleRef?.close();
  });

  /** Khách đồng ý tin Zalo + khuyến mãi, có giỏ một món bỏ quên từ `abandonedAgoMs` trước. */
  async function abandonedCart(abandonedAgoMs = 3 * HOUR) {
    const user = await createUser(prisma, {
      phone: uniquePhone('09'),
      phoneVerifiedAt: new Date(Date.now() - 30 * DAY),
      notifyPromo: true,
      notifyPromoAt: new Date(Date.now() - 10 * DAY),
      notifyOrderZalo: true,
      notifyOrderZaloAt: new Date(Date.now() - 10 * DAY),
      notifyOrderZaloSource: 'checkout',
    });
    userIds.push(user.id);
    const cart = await prisma.cart.create({ data: { userId: user.id, items: { create: { variationId, quantity: 2 } } } });
    const abandonedAt = new Date(Date.now() - abandonedAgoMs);
    await prisma.$executeRaw`UPDATE "carts" SET "updatedAt" = ${abandonedAt} WHERE "id" = ${cart.id}`;
    return { user, cart, abandonedAt };
  }

  const remind = (c: { user: { id: string }; cart: { id: string }; abandonedAt: Date }, remindedAt = new Date()) =>
    recorder.onCartAbandonReminded(
      { userId: c.user.id, cartId: c.cart.id, abandonedAt: c.abandonedAt, remindedAt, lines: [{ name: 'Nước rửa chén hữu cơ', quantity: 2 }] },
      remindedAt,
    );

  const rowsOf = (userId: string) => prisma.mssCartEvent.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  const postsFor = (cartRef: string) => calls.filter((c) => c.url.endsWith('/cart-events') && c.body.includes(cartRef));

  it('hai lượt ghi chồng nhau cho cùng khách (hai lần bỏ giỏ khác nhau): khoá advisory + đếm 7 ngày, đúng MỘT dòng', async () => {
    const c = await abandonedCart();
    const now = new Date();
    const [a, b] = await Promise.all([
      remind(c, now),
      recorder.onCartAbandonReminded(
        { userId: c.user.id, cartId: c.cart.id, abandonedAt: new Date(c.abandonedAt.getTime() - 60_000), remindedAt: now, lines: [{ name: 'x', quantity: 1 }] },
        now,
      ),
    ]);
    expect([a, b].sort()).toEqual(['deduped', 'recorded']);
    const rows = await rowsOf(c.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'cart.abandoned', status: 'PENDING', cartId: c.cart.id });
    const body = JSON.parse(rows[0]!.body);
    expect(body.customer.phone).toBe(c.user.phone);
    expect(body).not.toHaveProperty('price');
  });

  it('chặn 7 ngày: lần nhắc MSS đã nhận 6 ngày trước chặn, 8 ngày trước hay bị MSS từ chối thì không', async () => {
    const c = await abandonedCart();
    const seed = (createdAgoDays: number, status: string, resultStatus: string | null) =>
      prisma.mssCartEvent.create({
        data: {
          eventId: `01SEED${randCode(20).toUpperCase()}`,
          type: 'cart.abandoned',
          userId: c.user.id,
          cartRef: `c_seed_${randCode(12)}`,
          cartId: c.cart.id,
          cartUpdatedAt: new Date(Date.now() - createdAgoDays * DAY - HOUR),
          occurredAt: new Date(Date.now() - createdAgoDays * DAY),
          body: '{}',
          bodySha256: '0'.repeat(64),
          status,
          resultStatus,
          expiresAt: new Date(Date.now() - createdAgoDays * DAY + 40 * HOUR),
          createdAt: new Date(Date.now() - createdAgoDays * DAY),
        },
      });
    const blocker = await seed(6, 'ACCEPTED', 'sent');
    expect(await remind(c)).toBe('deduped');
    await prisma.mssCartEvent.delete({ where: { id: blocker.id } });
    // 2xx mà không đọc được mã: MSS có thể đang giữ, vẫn chặn.
    const unreadable = await seed(1, 'ACCEPTED', null);
    expect(await remind(c)).toBe('deduped');
    await prisma.mssCartEvent.delete({ where: { id: unreadable.id } });
    await seed(8, 'ACCEPTED', 'sent');
    await seed(1, 'REJECTED', null);
    await seed(2, 'ACCEPTED', 'suppressed');
    expect(await remind(c)).toBe('recorded');
  });

  it('hai lượt gửi chồng nhau: SKIP LOCKED, đúng MỘT POST /cart-events, dòng ACCEPTED với kết quả MSS', async () => {
    const c = await abandonedCart();
    expect(await remind(c)).toBe('recorded');
    const [row] = await rowsOf(c.user.id);
    reply = { status: 202, body: { status: 'queued' }, delayMs: 150 };
    const now = new Date();
    await Promise.all([sender.runOnce(now), sender.runOnce(now)]);
    expect(postsFor(row!.cartRef)).toHaveLength(1);
    expect(calls.find((x) => x.body.includes(row!.cartRef))!.url).toBe('https://mss.example.test/api/ext/tubu/v1/cart-events');
    const after = await prisma.mssCartEvent.findUniqueOrThrow({ where: { id: row!.id } });
    expect(after).toMatchObject({ status: 'ACCEPTED', resultStatus: 'queued', attempts: 1 });
  });

  it('khách sửa giỏ sau lần nhắc: kiểm lại trước khi gửi, SKIPPED cart_changed, không POST', async () => {
    const c = await abandonedCart();
    expect(await remind(c, new Date(Date.now() - 60_000))).toBe('recorded');
    await prisma.cart.update({ where: { id: c.cart.id }, data: { items: { create: { variationId: (await extraVariation()).id, quantity: 1 } } } });
    await prisma.cart.update({ where: { id: c.cart.id }, data: { couponCode: null } });
    const [row] = await rowsOf(c.user.id);
    await sender.runOnce(new Date());
    expect(postsFor(row!.cartRef)).toHaveLength(0);
    expect(await prisma.mssCartEvent.findUniqueOrThrow({ where: { id: row!.id } })).toMatchObject({ status: 'SKIPPED', resultReason: 'cart_changed' });
  });

  it('khách đặt đơn sau lần nhắc MSS đã nhận: ghi cart.recovered một lần và gửi, lượt sau không ghi lại', async () => {
    const c = await abandonedCart();
    expect(await remind(c)).toBe('recorded');
    await sender.runOnce(new Date());
    const [abandoned] = await rowsOf(c.user.id);
    expect(abandoned).toMatchObject({ status: 'ACCEPTED', resultStatus: 'queued' });
    await createOrder(prisma, { userId: c.user.id });
    calls.length = 0;
    await Promise.all([sender.runOnce(new Date()), sender.runOnce(new Date())]);
    await sender.runOnce(new Date());
    const recovered = (await rowsOf(c.user.id)).filter((r) => r.type === 'cart.recovered');
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ cartRef: abandoned!.cartRef, status: 'ACCEPTED' });
    const sent = calls.filter((x) => x.body.includes('"cart.recovered"') && x.body.includes(abandoned!.cartRef));
    expect(sent).toHaveLength(1);
    expect(Object.keys(JSON.parse(sent[0]!.body)).sort()).toEqual(['cart', 'event_id', 'occurred_at', 'sender', 'type']);
  });

  it('dọn dòng quá 30 ngày (thân có SĐT), giữ dòng 29 ngày', async () => {
    const c = await abandonedCart();
    const make = (days: number) =>
      prisma.mssCartEvent.create({
        data: {
          eventId: `01PURGE${randCode(19).toUpperCase()}`,
          type: 'cart.abandoned',
          userId: c.user.id,
          cartRef: `c_purge_${randCode(12)}`,
          cartId: c.cart.id,
          cartUpdatedAt: new Date(Date.now() - days * DAY),
          occurredAt: new Date(Date.now() - days * DAY),
          body: JSON.stringify({ customer: { phone: c.user.phone } }),
          bodySha256: '0'.repeat(64),
          status: 'EXPIRED',
          expiresAt: new Date(Date.now() - days * DAY + 40 * HOUR),
          createdAt: new Date(Date.now() - days * DAY),
        },
      });
    const old = await make(31);
    const recent = await make(29);
    await sender.runOnce(new Date());
    expect(await prisma.mssCartEvent.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.mssCartEvent.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });

  it('khách tắt khuyến mãi hay bị khoá sau khi MSS đã nhận lần nhắc: ghi cart.recovered (huỷ) một lần và gửi', async () => {
    for (const withdraw of [{ notifyPromo: false }, { isBlocked: true }]) {
      const c = await abandonedCart();
      expect(await remind(c)).toBe('recorded');
      await sender.runOnce(new Date());
      const [abandoned] = await rowsOf(c.user.id);
      expect(abandoned).toMatchObject({ status: 'ACCEPTED', resultStatus: 'queued' });
      await prisma.user.update({ where: { id: c.user.id }, data: withdraw });
      calls.length = 0;
      await Promise.all([sender.runOnce(new Date()), sender.runOnce(new Date())]);
      await sender.runOnce(new Date());
      const recovered = (await rowsOf(c.user.id)).filter((r) => r.type === 'cart.recovered');
      expect({ withdraw, recovered: recovered.length }).toEqual({ withdraw, recovered: 1 });
      expect(calls.filter((x) => x.body.includes('"cart.recovered"') && x.body.includes(abandoned!.cartRef))).toHaveLength(1);
    }
  });

  it('xoá tài khoản: lần nhắc chưa gửi bị xoá hẳn; lần nhắc MSS đang giữ được huỷ bằng cart.recovered không mang SĐT, rồi xoá dòng có SĐT', async () => {
    const pending = await abandonedCart();
    expect(await remind(pending)).toBe('recorded');
    await users.requestAccountDeletion(pending.user.id, undefined, { accepted: true, acknowledgedWalletBalance: 0 });
    const req1 = await prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId: pending.user.id, status: 'PENDING' } });
    await deletion.process(req1.id, admin.id);
    expect(await rowsOf(pending.user.id)).toHaveLength(0);

    const held = await abandonedCart();
    expect(await remind(held)).toBe('recorded');
    await sender.runOnce(new Date());
    const [abandoned] = await rowsOf(held.user.id);
    expect(abandoned).toMatchObject({ status: 'ACCEPTED', resultStatus: 'queued' });
    await users.requestAccountDeletion(held.user.id, undefined, { accepted: true, acknowledgedWalletBalance: 0 });
    const req2 = await prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId: held.user.id, status: 'PENDING' } });
    await deletion.process(req2.id, admin.id);
    const left = await rowsOf(held.user.id);
    expect(left.map((r) => [r.type, r.status])).toEqual([['cart.recovered', 'PENDING']]);
    expect(left[0]!.body).not.toContain(held.user.phone!);
    calls.length = 0;
    await sender.runOnce(new Date());
    expect(calls.filter((x) => x.body.includes('"cart.recovered"') && x.body.includes(abandoned!.cartRef))).toHaveLength(1);
  });

  async function extraVariation() {
    const tag = randCode(6);
    const p = await prisma.product.create({
      data: {
        brand: 'IT',
        slug: `itmsscart2-${tag}`,
        name: `Nước giặt ${tag}`,
        description: 'IT',
        basePrice: 50_000,
        variations: { create: { sku: `ITMSSC2-${tag}`, name: 'Can', attributes: {}, retailPrice: 50_000, stock: 10 } },
      },
      include: { variations: true },
    });
    productIds.push(p.id);
    return p.variations[0]!;
  }
});
