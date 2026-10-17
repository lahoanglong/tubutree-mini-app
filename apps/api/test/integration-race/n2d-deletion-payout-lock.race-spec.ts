import { AccountDeletionService } from '../../src/modules/users/account-deletion.service';
import { partnerHarness } from './n2b-harness';
import { sleep } from './helpers';

const DAY = 86_400_000;

/**
 * Ẩn danh tài khoản chủ gian hàng đối tác lấy khoá phiếu của từng gian hàng (lockOwnerStores) trước lần đếm vướng mắc. Phiếu đối soát
 * chỉ cần KEY SHARE gian hàng (khoá ngoại) nên khoá dòng gian hàng của ẩn danh không chặn được nó: nếu bỏ khoá phiếu thì một phiếu PENDING
 * (nợ gian hàng đã ẩn danh) có thể commit sau lần đếm.
 */
describe('Ẩn danh tài khoản và lập phiếu đối soát (real Postgres)', () => {
  let h: Awaited<ReturnType<typeof partnerHarness>>;
  let deletion: AccountDeletionService;
  beforeAll(async () => {
    h = await partnerHarness();
    deletion = new AccountDeletionService(h.prisma, h.fulfilment);
  });
  afterAll(async () => {
    await h?.cleanup();
  });

  it('ẩn danh đã đếm xong và đang dở: lập phiếu cho gian hàng phải đợi, không có phiếu PENDING nào xuất hiện giữa chừng', async () => {
    const c = await h.ownerStore({ role: 'DEALER', type: 'MERCHANT' });
    const addr = await h.address(c.owner.id);
    const request = await h.prisma.accountDeletionRequest.create({ data: { userId: c.owner.id, reason: 'IT' } });
    const holder = await h.hold((tx) => tx.$queryRaw`SELECT "id" FROM "addresses" WHERE "id" = ${addr.id} FOR UPDATE`);
    const running: Promise<unknown>[] = [];
    let payoutSettled = false;
    try {
      let d = false;
      running.push(deletion.process(request.id, c.adminUser.id).finally(() => (d = true)));
      await h.waitUntil(async () => d || (await h.lockWaiters(holder.pid)) >= 1, 'ẩn danh');
      // Khoản chờ đối soát xuất hiện sau lần đếm (ví dụ đơn vừa chuyển sang đã giao).
      await c.selfShip('DELIVERED', { deliveredAt: new Date(Date.now() - 30 * DAY), paymentStatus: 'PAID' });
      running.push(h.fulfilment.createPayout(c.adminUser.id, c.sf.id).finally(() => (payoutSettled = true)));
      await sleep(500);
      expect(payoutSettled).toBe(false);
      expect(await h.prisma.merchantPayout.count({ where: { storefrontId: c.sf.id } })).toBe(0);
    } finally {
      holder.release();
      await holder.done;
    }
    const settled = await Promise.allSettled(running);
    expect(settled[0]!.status).toBe('fulfilled');
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: c.owner.id } })).isBlocked).toBe(true);
  });
});
