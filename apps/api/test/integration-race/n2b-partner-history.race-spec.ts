import { AdminService } from '../../src/modules/admin/admin.service';
import { partnerHarness } from './n2b-harness';
import { sleep } from './helpers';

/**
 * Chỉ lần TẮT cờ đối tác ghi STOREFRONT_PARTNER, nên partnerHistory của getUserDetail hiện "Bật → Tắt" hai lần liền mà không có "Bật" ở
 * giữa. Duyệt hồ sơ đại lý và lần "bật lại" ở Cổng người bán giờ cũng ghi dòng false → true trong cùng transaction.
 */
describe('Lịch sử cờ đối tác ghi cả lần bật (real Postgres)', () => {
  let h: Awaited<ReturnType<typeof partnerHarness>>;
  let approver: AdminService;
  beforeAll(async () => {
    h = await partnerHarness();
    const none = {} as never;
    approver = new AdminService(h.prisma, none, none, none, { notify: jest.fn().mockResolvedValue(undefined) } as never, none, none, h.rbac, none, none, h.fulfilment);
  });
  afterAll(async () => {
    await h?.cleanup();
  });

  const history = async (c: Awaited<ReturnType<typeof h.ownerStore>>) =>
    (await h.admin.getUserDetail(c.owner.id)).partnerHistory.map((e) => `${e.fromValue}>${e.toValue}`);

  async function application(c: Awaited<ReturnType<typeof h.ownerStore>>) {
    return h.prisma.dealerApplication.create({
      data: { userId: c.owner.id, businessName: 'IT', ownerName: 'IT', phone: c.owner.phone!, address: 'IT', cccdFrontUrl: 'x', cccdBackUrl: 'x' },
    });
  }

  it('duyệt hồ sơ đại lý bật lại cờ gian hàng CTV đã tắt: ghi false→true sau dòng true→false (mới nhất trước)', async () => {
    const c = await h.ownerStore({ role: 'AFFILIATE', type: 'CTV', isPartner: true });
    const tier = await h.tier();
    await h.fulfilment.setStorePartner(c.adminUser.id, c.sf.id, false);
    await sleep(5);
    const app = await application(c);
    await approver.reviewDealerApplication(c.adminUser.id, app.id, true, tier.id);
    expect((await c.store()).isPartner).toBe(true);
    expect(await history(c)).toEqual(['false>true', 'true>false']);
    const [on] = await c.partnerEvents().then((e) => e.slice(-1));
    expect(on).toMatchObject({ fromValue: 'false', toValue: 'true', actorId: c.adminUser.id, reason: c.sf.id });
  });

  it('duyệt hồ sơ khi gian hàng đã là đối tác (hoặc không có gian hàng): không ghi dòng thừa', async () => {
    const c = await h.ownerStore({ role: 'AFFILIATE', type: 'CTV', isPartner: true });
    const tier = await h.tier();
    await approver.reviewDealerApplication(c.adminUser.id, (await application(c)).id, true, tier.id);
    expect(await history(c)).toEqual([]);

    const bare = await h.user('AFFILIATE');
    const adminUser = await h.user('ADMIN');
    const app = await h.prisma.dealerApplication.create({
      data: { userId: bare.id, businessName: 'IT', ownerName: 'IT', phone: bare.phone!, address: 'IT', cccdFrontUrl: 'x', cccdBackUrl: 'x' },
    });
    await approver.reviewDealerApplication(adminUser.id, app.id, true, tier.id);
    expect(await h.prisma.userAdminEvent.count({ where: { userId: bare.id, kind: 'STOREFRONT_PARTNER' } })).toBe(0);
  });

  it('Cổng người bán bật lại cờ của đại lý được duyệt lại: ghi false→true (chủ là người thực hiện), chỉ một lần dù mở nhiều lần', async () => {
    const c = await h.ownerStore({ role: 'DEALER', type: 'CTV', isPartner: false });
    await h.portal.getOrCreateStore(c.owner.id);
    await h.portal.getOrCreateStore(c.owner.id);
    expect((await c.store()).isPartner).toBe(true);
    const ev = await c.partnerEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ fromValue: 'false', toValue: 'true', actorId: c.owner.id, reason: c.sf.id });
  });

  it('chu kỳ đầy đủ: thu hồi (Tắt) rồi duyệt lại + vào Cổng (Bật) → partnerHistory xen kẽ, không hai Tắt liền nhau', async () => {
    const c = await h.ownerStore({ role: 'DEALER', type: 'CTV', isPartner: true });
    const tier = await h.tier();
    await h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'CUSTOMER');
    await sleep(5);
    await h.prisma.user.update({ where: { id: c.owner.id }, data: { role: 'AFFILIATE' } });
    await approver.reviewDealerApplication(c.adminUser.id, (await application(c)).id, true, tier.id);
    await sleep(5);
    await h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'CUSTOMER');
    expect(await history(c)).toEqual(['true>false', 'false>true', 'true>false']);
  });
});
