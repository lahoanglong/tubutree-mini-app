import { BadRequestException } from '@nestjs/common';
import { ACCOUNT_DELETION_BLOCKED, ANONYMIZED_NAME, AccountDeletionService } from '../../src/modules/users/account-deletion.service';
import { partnerHarness } from './n2b-harness';

const DAY = 86_400_000;

/**
 * Ẩn danh tài khoản của chủ gian hàng đối tác khi gian hàng còn đơn tự giao, khoản chờ đối soát... để lại chủ không đăng nhập được và
 * gian hàng không còn tài khoản nhận tiền. Giờ dùng cùng danh sách vướng mắc với thu hồi đại lý (partnerBlockers): từ chối bằng phản hồi
 * ACCOUNT_DELETION_BLOCKED cho tới khi gian hàng được đối soát xong.
 */
describe('Xoá tài khoản chủ gian hàng đối tác (real Postgres)', () => {
  let h: Awaited<ReturnType<typeof partnerHarness>>;
  let deletion: AccountDeletionService;
  beforeAll(async () => {
    h = await partnerHarness();
    deletion = new AccountDeletionService(h.prisma, h.fulfilment);
  });
  afterAll(async () => {
    await h?.cleanup();
  });

  async function withRequest(c: Awaited<ReturnType<typeof h.ownerStore>>) {
    await h.prisma.storefront.update({ where: { id: c.sf.id }, data: { bankName: 'ACB', bankAccountNo: '123456', bankAccountName: 'IT' } });
    return h.prisma.accountDeletionRequest.create({ data: { userId: c.owner.id, reason: 'IT' } });
  }
  async function blockedWith(p: Promise<unknown>) {
    const err = await p.then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    const body = (err as BadRequestException).getResponse() as { code: string; blockers: { code: string; message: string }[] };
    expect(body.code).toBe(ACCOUNT_DELETION_BLOCKED);
    return body.blockers;
  }

  it('chủ đại lý còn đơn tự giao SHIPPING: bị từ chối, không ẩn danh gì; đơn xong và đã đối soát thì xoá được', async () => {
    const c = await h.ownerStore({ role: 'DEALER', type: 'MERCHANT' });
    const request = await withRequest(c);
    const order = await c.selfShip('SHIPPING');

    const blockers = await blockedWith(deletion.process(request.id, c.adminUser.id));
    expect(blockers).toEqual([expect.objectContaining({ code: 'PARTNER_STORE_OPEN', message: expect.stringContaining('1 đơn tự giao chưa xong') })]);
    expect(await h.prisma.user.findUniqueOrThrow({ where: { id: c.owner.id } })).toMatchObject({ isBlocked: false, phone: c.owner.phone });
    expect(await c.store()).toMatchObject({ isPublished: true, bankAccountNo: '123456' });
    expect((await deletion.list('PENDING')).find((r) => r.id === request.id)?.blockers.map((b) => b.code)).toContain('PARTNER_STORE_OPEN');

    await h.prisma.order.update({ where: { id: order.id }, data: { status: 'DELIVERED', deliveredAt: new Date(Date.now() - 30 * DAY), paymentStatus: 'PAID' } });
    const pending = await blockedWith(deletion.process(request.id, c.adminUser.id));
    expect(pending[0]!.message).toContain('khoản chờ đối soát');

    const payout = await h.fulfilment.createPayout(c.adminUser.id, c.sf.id);
    const pendingPayout = await blockedWith(deletion.process(request.id, c.adminUser.id));
    expect(pendingPayout[0]!.message).toContain('phiếu đối soát chưa chuyển');
    await h.fulfilment.markPayoutPaid(c.adminUser.id, payout.id, 'REF-IT');

    await expect(deletion.process(request.id, c.adminUser.id)).resolves.toMatchObject({ alreadyProcessed: false });
    expect(await h.prisma.user.findUniqueOrThrow({ where: { id: c.owner.id } })).toMatchObject({ isBlocked: true, fullName: ANONYMIZED_NAME });
    expect(await c.store()).toMatchObject({ isPublished: false, bankAccountNo: null });
  });

  it.each([
    ['sản phẩm tự giao đang bán', async (c: Awaited<ReturnType<typeof h.ownerStore>>) => void (await h.product(c.sf.id)), '1 sản phẩm tự giao đang bán'],
    [
      'yêu cầu trả đang chờ',
      async (c: Awaited<ReturnType<typeof h.ownerStore>>) => {
        const o = await c.selfShip('CANCELLED');
        await h.prisma.returnRequest.create({ data: { orderId: o.id, userId: c.buyer.id, reason: 'IT', status: 'REQUESTED' } });
      },
      '1 yêu cầu trả hàng chờ xử lý',
    ],
  ])('chủ gian hàng CTV isPartner vướng "%s": bị từ chối', async (_n, setup, expected) => {
    const c = await h.ownerStore({ role: 'AFFILIATE', type: 'CTV', isPartner: true });
    const request = await withRequest(c);
    await setup(c);
    const blockers = await blockedWith(deletion.process(request.id, c.adminUser.id));
    expect(blockers[0]!.message).toContain(expected);
  });

  it('người không có gian hàng đối tác (khách, CTV gian hàng thường) xoá bình thường dù có đơn tự giao cũ đã huỷ', async () => {
    const customer = await h.user('CUSTOMER');
    const r1 = await h.prisma.accountDeletionRequest.create({ data: { userId: customer.id, reason: 'IT' } });
    const adminUser = await h.user('ADMIN');
    await expect(deletion.process(r1.id, adminUser.id)).resolves.toMatchObject({ alreadyProcessed: false });

    const c = await h.ownerStore({ role: 'AFFILIATE', type: 'CTV', isPartner: false });
    await c.selfShip('SHIPPING');
    const r2 = await withRequest(c);
    await expect(deletion.process(r2.id, c.adminUser.id)).resolves.toMatchObject({ alreadyProcessed: false });
  });

  it('không vướng mắc: chủ gian hàng đối tác sạch xoá được', async () => {
    const c = await h.ownerStore({ role: 'DEALER', type: 'MERCHANT' });
    await c.selfShip('CANCELLED');
    const request = await withRequest(c);
    await expect(deletion.process(request.id, c.adminUser.id)).resolves.toMatchObject({ alreadyProcessed: false });
  });

  it('đua với lập phiếu đối soát (6 vòng): không 40P01, không bao giờ ẩn danh khi gian hàng còn khoản chờ hoặc phiếu chưa chuyển', async () => {
    for (let round = 0; round < 6; round++) {
      const c = await h.ownerStore({ role: 'DEALER', type: 'MERCHANT' });
      await c.selfShip('DELIVERED', { deliveredAt: new Date(Date.now() - 30 * DAY), paymentStatus: 'PAID' });
      const request = await withRequest(c);
      const run = [
        () => deletion.process(request.id, c.adminUser.id),
        () => h.fulfilment.createPayout(c.adminUser.id, c.sf.id),
      ];
      const settled = await Promise.allSettled((round % 2 ? run.reverse() : run).map((f) => f()));
      const errors = settled.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));
      expect(errors.join(' ')).not.toMatch(/40P01|deadlock/i);
      const owner = await h.prisma.user.findUniqueOrThrow({ where: { id: c.owner.id } });
      expect(owner.isBlocked).toBe(false);
    }
  });
});
