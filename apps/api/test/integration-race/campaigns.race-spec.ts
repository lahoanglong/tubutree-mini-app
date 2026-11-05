import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { CampaignsService } from '../../src/modules/campaigns/campaigns.service';
import { CampaignsAdminService } from '../../src/modules/campaigns/campaigns-admin.service';
import { randCode, warmPool } from './helpers';

/**
 * Chiến dịch (P11) trên Postgres thật: đọc công khai theo lịch/vị trí/đối tượng, và hai nhân viên cùng sửa một chiến dịch.
 */
describe('Campaigns (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let admin: CampaignsAdminService;
  let pub: CampaignsService;
  const DAY = 86_400_000;
  const tag = randCode(6).toLowerCase();
  const IMAGE = 'https://example.test/banner.jpg';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    admin = new CampaignsAdminService(prisma);
    pub = new CampaignsService(prisma, new CatalogService(prisma));
  });

  afterAll(async () => {
    await prisma.campaign.deleteMany({ where: { slug: { startsWith: `it-cmp-${tag}` } } });
    await prisma.coupon.deleteMany({ where: { code: { startsWith: `ITCMP${tag.toUpperCase()}` } } });
    await prisma.product.deleteMany({ where: { slug: { startsWith: `it-cmp-${tag}` } } });
    await moduleRef?.close();
  });

  async function product(name: string, suffix: string) {
    const code = `${tag}-${suffix}`;
    const p = await prisma.product.create({
      data: { pancakeId: `it-cmp-p-${code}`, brand: 'IT', slug: `it-cmp-${code}`, name, description: 'IT', basePrice: 100_000 },
    });
    await prisma.variation.create({
      data: { pancakeId: `it-cmp-v-${code}`, productId: p.id, sku: `CMP-${code}`, name: 'Chai', attributes: {}, retailPrice: 100_000, salePrice: 80_000, stock: 5 },
    });
    return p;
  }

  const base = (slug: string, over: Record<string, unknown> = {}) => ({
    title: `Chiến dịch ${slug}`,
    slug: `it-cmp-${tag}-${slug}`,
    placement: 'HOME_TOP' as const,
    // Đích trong app: bật ngay được dù chưa gắn sản phẩm (trang chiến dịch trống thì kiểm trước khi bật chặn, xem nhóm "kiểm trước khi bật").
    linkType: 'URL_INTERNAL' as const,
    linkValue: '/offers',
    image: IMAGE,
    startAt: new Date(Date.now() - DAY).toISOString(),
    endAt: new Date(Date.now() + DAY).toISOString(),
    ...over,
  });

  it('hai lệnh tạo cùng slug cùng lúc: một lệnh được, lệnh kia báo trùng slug (409), trong DB chỉ có một dòng', async () => {
    const dto = base('trung');
    const results = await Promise.allSettled([admin.create(dto), admin.create(dto)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
    expect(failed.reason).toBeInstanceOf(ConflictException);
    expect(await prisma.campaign.count({ where: { slug: dto.slug } })).toBe(1);
  });

  it('hai nhân viên cùng thay danh sách sản phẩm: kết quả là đúng một trong hai danh sách, không trộn', async () => {
    const created = await admin.create(base('sp'));
    const [a, b, c, d] = await Promise.all([product('A', 'a'), product('B', 'b'), product('C', 'c'), product('D', 'd')]);
    await Promise.allSettled([admin.setProducts(created.id, [a.id, b.id]), admin.setProducts(created.id, [c.id, d.id])]);
    const left = (await prisma.campaignProduct.findMany({ where: { campaignId: created.id }, orderBy: { sortOrder: 'asc' } })).map((r) => r.productId);
    expect([[a.id, b.id], [c.id, d.id]]).toContainEqual(left);
  });

  it('đọc công khai: chỉ chiến dịch đang chạy đúng vị trí và đối tượng; hết hạn hay tắt thì 404; sản phẩm đúng thứ tự gửi lên', async () => {
    const live = await admin.create(base('live', { audience: 'NEW' }));
    await admin.create(base('old', { endAt: new Date(Date.now() - 1000).toISOString(), startAt: new Date(Date.now() - DAY).toISOString() }));
    await admin.create(base('off', { isActive: false }));
    await admin.create(base('offers', { placement: 'OFFERS_TOP' }));
    await admin.create(base('cu', { audience: 'RETURNING' }));

    const forNew = (await pub.listPublic('HOME_TOP', 'NEW')).map((b) => b.slug).filter((s) => s.startsWith(`it-cmp-${tag}`));
    expect(forNew).toContain(`it-cmp-${tag}-live`);
    expect(forNew).not.toContain(`it-cmp-${tag}-old`);
    expect(forNew).not.toContain(`it-cmp-${tag}-off`);
    expect(forNew).not.toContain(`it-cmp-${tag}-offers`);
    expect(forNew).not.toContain(`it-cmp-${tag}-cu`);

    await expect(pub.getPublic(`it-cmp-${tag}-old`)).rejects.toBeInstanceOf(NotFoundException);
    await expect(pub.getPublic(`it-cmp-${tag}-off`)).rejects.toBeInstanceOf(NotFoundException);
    expect((await pub.getPublic(`it-cmp-${tag}-live`)).productCount).toBe(0);

    const [p1, p2, p3] = await Promise.all([product('Một', 'p1'), product('Hai', 'p2'), product('Ba', 'p3')]);
    await admin.setProducts(live.id, [p3.id, p1.id, p2.id]);
    const page = await pub.getProducts(`it-cmp-${tag}-live`, 1, 2);
    expect(page.data.map((x) => x.id)).toEqual([p3.id, p1.id]);
    expect(page.meta.total).toBe(3);
    expect((await pub.getPublic(`it-cmp-${tag}-live`)).productCount).toBe(3);
  });

  it('mã gắn kèm: chỉ hiện mã công khai còn hạn; mã đã hết lượt hay hết hạn bị ẩn khỏi trang', async () => {
    const c = await admin.create(base('coupon'));
    const mk = (suffix: string, over: Record<string, unknown> = {}) =>
      prisma.coupon.create({
        data: {
          code: `ITCMP${tag.toUpperCase()}${suffix}`,
          type: 'PERCENT',
          value: 10,
          scope: 'PUBLIC',
          startAt: new Date(Date.now() - DAY),
          endAt: new Date(Date.now() + DAY),
          ...over,
        },
      });
    const ok = await mk('OK');
    const full = await mk('FULL', { usageLimit: 1, usedCount: 1 });
    const expired = await mk('OLD', { endAt: new Date(Date.now() - 1000) });
    await admin.setCoupons(c.id, [ok.code, full.code, expired.code]);
    const detail = await pub.getPublic(`it-cmp-${tag}-coupon`);
    expect(detail.coupons.map((x) => x.code)).toEqual([ok.code]);
  });

  describe('kiểm trước khi bật (health)', () => {
    const issuesOf = (list: Awaited<ReturnType<typeof admin.list>>, id: string) => list.find((r) => r.id === id)!.health;

    it('trang chiến dịch trống không bật được; gắn sản phẩm hiển thị thì bật được và khách thấy', async () => {
      const draft = await admin.create(base('trong', { linkType: 'CAMPAIGN_PAGE', linkValue: undefined, isActive: false }));
      await expect(admin.update(draft.id, { isActive: true })).rejects.toBeInstanceOf(BadRequestException);
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: draft.id } })).isActive).toBe(false);
      expect(issuesOf(await admin.list(), draft.id)).toEqual({ blockers: 1, warnings: 0 });

      const p = await product('Hiển thị', 'trong');
      await admin.setProducts(draft.id, [p.id]);
      await admin.update(draft.id, { isActive: true });
      expect(issuesOf(await admin.list(), draft.id)).toEqual({ blockers: 0, warnings: 0 });
      expect((await pub.getPublic(draft.slug)).productCount).toBe(1);
    });

    it('sản phẩm ẩn không cứu được trang trống; bật hiển thị lại thì bật được', async () => {
      const draft = await admin.create(base('an', { linkType: 'CAMPAIGN_PAGE', linkValue: undefined, isActive: false }));
      const hidden = await product('Đang ẩn', 'an');
      await prisma.product.update({ where: { id: hidden.id }, data: { isActive: false } });
      await admin.setProducts(draft.id, [hidden.id]);
      await expect(admin.update(draft.id, { isActive: true })).rejects.toThrow(/Trang chiến dịch đang trống/);
      await prisma.product.update({ where: { id: hidden.id }, data: { isActive: true } });
      await expect(admin.update(draft.id, { isActive: true })).resolves.toMatchObject({ isActive: true });
    });

    it('đích sản phẩm ẩn hoặc chưa duyệt: tạo bật bị chặn, tạo nháp được và hiện 1 lỗi chặn trong danh sách', async () => {
      const p = await product('Chờ duyệt', 'duyet');
      await prisma.product.update({ where: { id: p.id }, data: { approvalStatus: 'PENDING_REVIEW' } });
      const input = base('dich', { linkType: 'PRODUCT', linkValue: p.slug });
      await expect(admin.create({ ...input, isActive: true })).rejects.toThrow(/đang ẩn hoặc chưa được duyệt/);
      expect(await prisma.campaign.count({ where: { slug: input.slug } })).toBe(0);
      const draft = await admin.create({ ...input, isActive: false });
      expect(issuesOf(await admin.list(), draft.id).blockers).toBe(1);
      await prisma.product.update({ where: { id: p.id }, data: { approvalStatus: 'APPROVED' } });
      expect(issuesOf(await admin.list(), draft.id).blockers).toBe(0);
      await expect(admin.update(draft.id, { isActive: true })).resolves.toMatchObject({ isActive: true });
    });

    it('check cho form chưa lưu: mã hết hạn và sản phẩm hết hàng là cảnh báo, không chặn', async () => {
      const p = await product('Hết hàng', 'het');
      await prisma.variation.updateMany({ where: { productId: p.id }, data: { stock: 0 } });
      const old = await prisma.coupon.create({
        data: { code: `ITCMP${tag.toUpperCase()}HETHAN`, type: 'PERCENT', value: 10, scope: 'PUBLIC', startAt: new Date(Date.now() - 3 * DAY), endAt: new Date(Date.now() - DAY) },
      });
      const out = await admin.check({
        placement: 'OFFERS_TOP',
        startAt: new Date(Date.now() - DAY).toISOString(),
        endAt: new Date(Date.now() + DAY).toISOString(),
        productIds: [p.id],
        couponCodes: [old.code],
      });
      expect(out.blockers).toBe(0);
      expect(out.issues.map((i) => i.code).sort()).toEqual(['COUPON_EXPIRED', 'PRODUCTS_UNAVAILABLE']);
    });

    const usableCoupon = (suffix: string) =>
      prisma.coupon.create({
        data: { code: `ITCMP${tag.toUpperCase()}${suffix}`, type: 'PERCENT', value: 10, scope: 'PUBLIC', startAt: new Date(Date.now() - DAY), endAt: new Date(Date.now() + DAY) },
      });
    const livePage = async (slug: string) => {
      const c = await admin.create(base(slug, { linkType: 'CAMPAIGN_PAGE', linkValue: undefined, isActive: false }));
      await admin.setProducts(c.id, [(await product(`SP ${slug}`, slug)).id]);
      await admin.update(c.id, { isActive: true });
      return c;
    };
    const linksOf = async (id: string) => ({
      products: await prisma.campaignProduct.count({ where: { campaignId: id } }),
      coupons: await prisma.campaignCoupon.count({ where: { campaignId: id } }),
    });

    it('trang đang bật: gỡ sản phẩm cuối bị chặn và không ghi gì; còn mã dùng được thì gỡ được; chiến dịch tắt thì gỡ thoải mái', async () => {
      const c = await livePage('put1');
      await expect(admin.setProducts(c.id, [])).rejects.toThrow(/Trang chiến dịch đang trống/);
      expect(await linksOf(c.id)).toEqual({ products: 1, coupons: 0 });

      const k = await usableCoupon('PUT1');
      await admin.setCoupons(c.id, [k.code]);
      await expect(admin.setProducts(c.id, [])).resolves.toEqual({ count: 0 });
      await expect(admin.setCoupons(c.id, [])).rejects.toBeInstanceOf(BadRequestException);
      expect(await linksOf(c.id)).toEqual({ products: 0, coupons: 1 });

      await admin.update(c.id, { isActive: false });
      await expect(admin.setCoupons(c.id, [])).resolves.toEqual({ count: 0 });
    });

    it('hai nhân viên cùng gỡ sản phẩm và mã cuối của trang đang bật: đúng một lệnh thắng, trang không bao giờ trống', async () => {
      const c = await livePage('put2');
      const k = await usableCoupon('PUT2');
      await admin.setCoupons(c.id, [k.code]);
      const results = await Promise.allSettled([admin.setProducts(c.id, []), admin.setCoupons(c.id, [])]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
      expect(failed.reason).toBeInstanceOf(BadRequestException);
      const left = await linksOf(c.id);
      expect(left.products + left.coupons).toBe(1);
    });

    it('bật chiến dịch song song gỡ sản phẩm cuối của trang: sau cả hai không bao giờ có trang đang bật mà trống (nhiều vòng)', async () => {
      for (let round = 0; round < 8; round++) {
        const c = await admin.create(base(`rc${round}`, { linkType: 'CAMPAIGN_PAGE', linkValue: undefined, isActive: false }));
        await admin.setProducts(c.id, [(await product(`SP rc${round}`, `rc${round}`)).id]);
        const results = await Promise.allSettled([admin.update(c.id, { isActive: true }), admin.setProducts(c.id, [])]);
        for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(BadRequestException);
        const row = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
        const left = await linksOf(c.id);
        expect(row.isActive && left.products + left.coupons === 0).toBe(false);
      }
    });

    it('đổi đích sang trang chiến dịch song song gỡ sản phẩm cuối: không bao giờ có trang chiến dịch đang bật mà trống (nhiều vòng)', async () => {
      for (let round = 0; round < 8; round++) {
        const c = await admin.create(base(`rl${round}`));
        await admin.setProducts(c.id, [(await product(`SP rl${round}`, `rl${round}`)).id]);
        const results = await Promise.allSettled([admin.update(c.id, { linkType: 'CAMPAIGN_PAGE' }), admin.setProducts(c.id, [])]);
        for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(BadRequestException);
        const row = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
        const left = await linksOf(c.id);
        expect(row.isActive && row.linkType === 'CAMPAIGN_PAGE' && left.products + left.coupons === 0).toBe(false);
      }
    });

    /** Chờ tới khi có backend Postgres đang CHỜ khoá (wait_event_type = 'Lock') chạy câu lệnh khớp `query`; không chỉ ngủ rồi đoán. */
    const waitForLockWait = async (query: RegExp, event?: (e: string | null) => boolean) => {
      for (let i = 0; i < 100; i++) {
        const rows = await prisma.$queryRaw<{ query: string; wait_event: string | null }[]>`
          SELECT query, wait_event FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'`;
        if (rows.some((r) => query.test(r.query) && (!event || event(r.wait_event)))) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`không thấy backend nào chờ khoá với câu lệnh ${query}`);
    };

    /**
     * Tất định, không dựa may rủi: giữ khoá dòng chiến dịch trong một giao dịch, gọi `update` (không await) rồi xoá liên kết ngay trong giao dịch giữ khoá.
     * `update` phải chờ khoá (chưa xong sau một khoảng ngắn), và khi nhả khoá nó thấy trang trống nên 400, không ghi gì.
     */
    const updateWhileLockHeld = async (id: string, patch: Parameters<CampaignsAdminService['update']>[1]) => {
      let settled = false;
      let outcome: Promise<unknown> | undefined;
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "campaigns" WHERE "id" = ${id} FOR UPDATE`;
          outcome = admin.update(id, patch).then(
            (v) => ((settled = true), v),
            (e: unknown) => ((settled = true), e),
          );
          await waitForLockWait(/FOR UPDATE/);
          expect(settled).toBe(false);
          await tx.campaignProduct.deleteMany({ where: { campaignId: id } });
        },
        { timeout: 20_000 },
      );
      return outcome!;
    };

    it('giữ khoá dòng: bật chiến dịch phải chờ, khi người giữ khoá gỡ sản phẩm cuối rồi commit thì lệnh bật 400 và trang không bật', async () => {
      const c = await admin.create(base('lk1', { linkType: 'CAMPAIGN_PAGE', linkValue: undefined, isActive: false }));
      await admin.setProducts(c.id, [(await product('SP lk1', 'lk1')).id]);
      const out = await updateWhileLockHeld(c.id, { isActive: true });
      expect(out).toBeInstanceOf(BadRequestException);
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).isActive).toBe(false);
    });

    it('giữ khoá dòng: đổi đích sang trang chiến dịch phải chờ, khi người giữ khoá gỡ sản phẩm cuối thì lệnh đổi 400 và đích không đổi', async () => {
      const c = await admin.create(base('lk2'));
      await admin.setProducts(c.id, [(await product('SP lk2', 'lk2')).id]);
      const out = await updateWhileLockHeld(c.id, { linkType: 'CAMPAIGN_PAGE' });
      expect(out).toBeInstanceOf(BadRequestException);
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).linkType).toBe('URL_INTERNAL');
    });

    /**
     * Tất định cho "kiểm + ghi cùng MỘT giao dịch". Test giữ khoá bảng SHARE trên `campaigns`: nó xung đột với UPDATE (ROW EXCLUSIVE) nhưng không với
     * SELECT ... FOR UPDATE (ROW SHARE), nên `update(isActive)` qua được khoá dòng và bước kiểm rồi đứng đúng ở bước GHI. `setProducts(id, [])` phải xếp
     * hàng sau khoá dòng của update; nhả khoá bảng thì update xong trước, rồi setProducts thấy trang bật mà sắp trống nên 400. Nếu kiểm và ghi tách thành
     * hai giao dịch thì khoá dòng đã nhả trước bước ghi, setProducts chen vào gỡ A (lúc đó chiến dịch còn tắt) rồi trang bật lên sẽ trống.
     * (Dùng khoá bảng thay vì trigger: UPDATE khoá dòng trước khi chạy trigger BEFORE nên trigger không dừng được ở giữa kiểm và ghi.)
     */
    it('update dừng ở bước ghi: PUT sản phẩm [] phải chờ khoá dòng, nhả khoá thì update thành công, PUT 400, chiến dịch bật và còn [A]', async () => {
      const c = await admin.create(base('trg', { linkType: 'CAMPAIGN_PAGE', linkValue: undefined, isActive: false }));
      const a = await product('SP trg', 'trg');
      await admin.setProducts(c.id, [a.id]);
      let updDone = false;
      let putDone = false;
      let upd: Promise<unknown> | undefined;
      let put: Promise<unknown> | undefined;
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe('LOCK TABLE "campaigns" IN SHARE MODE');
          upd = admin.update(c.id, { isActive: true }).then(
            (v) => ((updDone = true), v),
            (e: unknown) => ((updDone = true), e),
          );
          await waitForLockWait(/^\s*UPDATE/, (e) => e === 'relation');
          put = admin.setProducts(c.id, []).then(
            (v) => ((putDone = true), v),
            (e: unknown) => ((putDone = true), e),
          );
          await waitForLockWait(/FOR UPDATE/, (e) => e !== 'relation');
          expect(updDone).toBe(false);
          expect(putDone).toBe(false);
        },
        { timeout: 20_000 },
      );
      expect(await upd).toMatchObject({ isActive: true });
      expect(await put).toBeInstanceOf(BadRequestException);
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).isActive).toBe(true);
      expect(await linksOf(c.id)).toEqual({ products: 1, coupons: 0 });
    });

    it('đang chạy CAMPAIGN_PAGE [A]: đổi đích sang PRODUCT trước thì gỡ A được (đúng thứ tự form); gỡ A trước khi đổi đích thì 400', async () => {
      const c = await livePage('pg2p');
      const target = await product('SP đích', 'pg2p-dich');
      await expect(admin.setProducts(c.id, [])).rejects.toThrow(/Trang chiến dịch đang trống/);
      await expect(admin.update(c.id, { linkType: 'PRODUCT', linkValue: target.slug })).resolves.toMatchObject({ linkType: 'PRODUCT', isActive: true });
      await expect(admin.setProducts(c.id, [])).resolves.toEqual({ count: 0 });
      expect(await linksOf(c.id)).toEqual({ products: 0, coupons: 0 });
    });

    it('trang đang chạy chỉ còn mã hết hạn ngày mai: dời startAt sang sau hạn mã thì 400 và startAt không đổi; dời sớm hoặc giữ nguyên thì được', async () => {
      const c = await admin.create(base('dstart', { linkType: 'CAMPAIGN_PAGE', linkValue: undefined, isActive: false, endAt: new Date(Date.now() + 10 * DAY).toISOString() }));
      const k = await usableCoupon('DSTART');
      await admin.setCoupons(c.id, [k.code]);
      await admin.update(c.id, { isActive: true });
      const before = (await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).startAt.getTime();
      await expect(admin.update(c.id, { startAt: new Date(Date.now() + 3 * DAY).toISOString() })).rejects.toThrow(/Trang chiến dịch đang trống/);
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).startAt.getTime()).toBe(before);
      await expect(admin.update(c.id, { title: 'Đổi tên' })).resolves.toMatchObject({ isActive: true });
      await expect(admin.update(c.id, { startAt: new Date(Date.now() - 2 * DAY).toISOString() })).resolves.toMatchObject({ isActive: true });
    });

    it('sửa chiến dịch đang bật đổi đích sang trang chiến dịch kèm sản phẩm: trường khác trước, gắn sản phẩm, đích ở cuối thì được; đổi đích trước khi có sản phẩm thì 400', async () => {
      const c = await admin.create(base('doi-dich'));
      await expect(admin.update(c.id, { linkType: 'CAMPAIGN_PAGE' })).rejects.toThrow(/Trang chiến dịch đang trống/);
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).linkType).toBe('URL_INTERNAL');
      await admin.update(c.id, { title: 'Đổi tên' });
      await admin.setProducts(c.id, [(await product('SP doi-dich', 'doi-dich')).id]);
      await expect(admin.update(c.id, { linkType: 'CAMPAIGN_PAGE' })).resolves.toMatchObject({ linkType: 'CAMPAIGN_PAGE', isActive: true });
    });

    it('gia hạn chiến dịch đã hết hạn là một lần bật: trang trống thì 400 và endAt không đổi; có sản phẩm thì gia hạn được', async () => {
      const past = base('het-han', { linkType: 'CAMPAIGN_PAGE', linkValue: undefined, isActive: false, startAt: new Date(Date.now() - 3 * DAY).toISOString(), endAt: new Date(Date.now() - DAY).toISOString() });
      const c = await admin.create(past);
      await prisma.campaign.update({ where: { id: c.id }, data: { isActive: true } });
      const later = new Date(Date.now() + DAY).toISOString();
      await expect(admin.update(c.id, { endAt: later })).rejects.toThrow(/Trang chiến dịch đang trống/);
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).endAt.getTime()).toBeLessThan(Date.now());
      await admin.setProducts(c.id, [(await product('SP het-han', 'het-han')).id]);
      await expect(admin.update(c.id, { endAt: later })).resolves.toMatchObject({ isActive: true });
    });

    describe('lưu một lệnh: PATCH/POST kèm danh sách, một giao dịch, 400 thì không ghi gì', () => {
      const offset = (days: number) => new Date(Date.now() + days * DAY);
      const couponAt = (suffix: string, startDays: number, endDays: number) =>
        prisma.coupon.create({
          data: { code: `ITCMP${tag.toUpperCase()}${suffix}`, type: 'PERCENT', value: 10, scope: 'PUBLIC', startAt: offset(startDays), endAt: offset(endDays) },
        });
      const page = (slug: string, over: Record<string, unknown> = {}) =>
        admin.create(base(slug, { linkType: 'CAMPAIGN_PAGE', linkValue: undefined, isActive: false, startAt: offset(-5).toISOString(), endAt: offset(20).toISOString(), ...over }));
      const row = (id: string) => prisma.campaign.findUniqueOrThrow({ where: { id } });
      const codesOf = async (id: string) => (await prisma.campaignCoupon.findMany({ where: { campaignId: id }, include: { coupon: true } })).map((l) => l.coupon.code).sort();

      it('(1) dời startAt sang tương lai kèm thêm mã Y mở đúng mốc mới, mã cũ X hết hạn trước đó: được, một lệnh; thiếu Y thì 400 và không ghi gì', async () => {
        const x = await couponAt('X1', -10, 1);
        const y = await couponAt('Y1', 5, 30);
        const c = await page('v1');
        await admin.setCoupons(c.id, [x.code]);
        await admin.update(c.id, { isActive: true });
        const startAt = offset(5).toISOString();
        const before = await row(c.id);
        await expect(admin.update(c.id, { startAt, title: 'Chỉ dời giờ' })).rejects.toThrow(/Lần lưu này làm trang đang chạy thành trống/);
        expect(await row(c.id)).toMatchObject({ title: before.title, startAt: before.startAt });
        const out = await admin.update(c.id, { startAt, couponCodes: [x.code, y.code] });
        expect(out.couponCodes.sort()).toEqual([x.code, y.code].sort());
        expect((await row(c.id)).startAt.toISOString()).toBe(startAt);
        expect(await codesOf(c.id)).toEqual([x.code, y.code].sort());
      });

      it('(2) trang đã trống sẵn (lỗi cũ) + dời startAt về quá khứ: được', async () => {
        const c = await page('v2');
        await prisma.campaign.update({ where: { id: c.id }, data: { isActive: true } });
        const startAt = offset(-8).toISOString();
        await expect(admin.update(c.id, { startAt })).resolves.toMatchObject({ isActive: true });
        expect((await row(c.id)).startAt.toISOString()).toBe(startAt);
      });

      it('(3) startAt có giây, trang trống sẵn, chỉ sửa tiêu đề (gửi lại đúng startAt): được', async () => {
        const startAt = new Date(Date.now() - 3 * DAY + 1234).toISOString();
        const c = await page('v3', { startAt });
        await prisma.campaign.update({ where: { id: c.id }, data: { isActive: true } });
        await expect(admin.update(c.id, { title: 'Tiêu đề mới', startAt })).resolves.toMatchObject({ title: 'Tiêu đề mới' });
        expect((await row(c.id)).title).toBe('Tiêu đề mới');
      });

      it('(4) CAMPAIGN_PAGE [A] đang chạy → PRODUCT và bỏ A trong một lệnh: được', async () => {
        const c = await livePage('v4');
        const target = await product('SP đích v4', 'v4-dich');
        await expect(admin.update(c.id, { linkType: 'PRODUCT', linkValue: target.slug, productIds: [] })).resolves.toMatchObject({ linkType: 'PRODUCT', isActive: true });
        expect(await linksOf(c.id)).toEqual({ products: 0, coupons: 0 });
      });

      it('(5) đang chạy đổi sang CAMPAIGN_PAGE kèm thêm sản phẩm trong một lệnh: được; thiếu sản phẩm thì 400 và đích không đổi', async () => {
        const c = await admin.create(base('v5'));
        await expect(admin.update(c.id, { linkType: 'CAMPAIGN_PAGE' })).rejects.toThrow(/Trang chiến dịch đang trống/);
        expect((await row(c.id)).linkType).toBe('URL_INTERNAL');
        const a = await product('SP v5', 'v5');
        await expect(admin.update(c.id, { linkType: 'CAMPAIGN_PAGE', productIds: [a.id] })).resolves.toMatchObject({ linkType: 'CAMPAIGN_PAGE', isActive: true });
        expect(await linksOf(c.id)).toEqual({ products: 1, coupons: 0 });
      });

      it('(6) bỏ A và sửa tiêu đề (trang thành trống): 400, tiêu đề KHÔNG đổi, A còn nguyên', async () => {
        const c = await livePage('v6');
        const before = await row(c.id);
        await expect(admin.update(c.id, { title: 'Không được lưu', productIds: [] })).rejects.toThrow(/Lần lưu này làm trang đang chạy thành trống/);
        expect((await row(c.id)).title).toBe(before.title);
        expect(await linksOf(c.id)).toEqual({ products: 1, coupons: 0 });
      });

      it('(7) gia hạn chiến dịch đã hết hạn mà đích là sản phẩm đang ẩn: 400, endAt không đổi', async () => {
        const hidden = await product('SP ẩn v7', 'v7');
        await prisma.product.update({ where: { id: hidden.id }, data: { isActive: false } });
        const c = await admin.create(base('v7', { linkType: 'PRODUCT', linkValue: hidden.slug, isActive: false, startAt: offset(-3).toISOString(), endAt: offset(-1).toISOString() }));
        await prisma.campaign.update({ where: { id: c.id }, data: { isActive: true } });
        await expect(admin.update(c.id, { endAt: offset(5).toISOString() })).rejects.toBeInstanceOf(BadRequestException);
        expect((await row(c.id)).endAt.getTime()).toBeLessThan(Date.now());
      });

      it('(8) tạo mới CAMPAIGN_PAGE đang bật kèm sản phẩm hiển thị: một request; thiếu sản phẩm thì 400 và không có dòng nào', async () => {
        const a = await product('SP v8', 'v8');
        const slug = `it-cmp-${tag}-v8`;
        await expect(admin.create(base('v8', { linkType: 'CAMPAIGN_PAGE', linkValue: undefined, isActive: true }))).rejects.toThrow(/Trang chiến dịch đang trống/);
        expect(await prisma.campaign.count({ where: { slug } })).toBe(0);
        const out = await admin.create(base('v8', { linkType: 'CAMPAIGN_PAGE', linkValue: undefined, isActive: true, productIds: [a.id] }));
        expect(out).toMatchObject({ isActive: true, products: [{ id: a.id }] });
        expect(await linksOf(out.id)).toEqual({ products: 1, coupons: 0 });
      });

      it('(9) thay mã X đang dùng được bằng Y chưa mở trên trang đang chạy: 400, X còn nguyên', async () => {
        const x = await couponAt('X9', -5, 20);
        const y = await couponAt('Y9', 3, 30);
        const c = await page('v9');
        await admin.setCoupons(c.id, [x.code]);
        await admin.update(c.id, { isActive: true });
        await expect(admin.update(c.id, { couponCodes: [y.code] })).rejects.toThrow(/Lần lưu này làm trang đang chạy thành trống/);
        expect(await codesOf(c.id)).toEqual([x.code]);
      });

      it('PATCH một lệnh gỡ sản phẩm song song PUT mã []: không bao giờ có trang đang chạy mà trống (nhiều vòng)', async () => {
        for (let round = 0; round < 8; round++) {
          const c = await page(`pr${round}`);
          const a = await product(`SP pr${round}`, `pr${round}`);
          const k = await couponAt(`PR${round}`, -1, 10);
          await admin.setProducts(c.id, [a.id]);
          await admin.setCoupons(c.id, [k.code]);
          await admin.update(c.id, { isActive: true });
          const results = await Promise.allSettled([admin.update(c.id, { productIds: [] }), admin.setCoupons(c.id, [])]);
          expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
          for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(BadRequestException);
          const left = await linksOf(c.id);
          expect(left.products + left.coupons).toBe(1);
        }
      });

      it('hai PATCH một lệnh cùng bỏ hết sản phẩm của trang đang chạy: đúng một lệnh thắng nếu còn mã, không thì cả hai bị chặn; trang không bao giờ trống', async () => {
        for (let round = 0; round < 6; round++) {
          const c = await livePage(`pp${round}`);
          const results = await Promise.allSettled([admin.update(c.id, { title: 'A', productIds: [] }), admin.update(c.id, { title: 'B', productIds: [] })]);
          expect(results.every((r) => r.status === 'rejected')).toBe(true);
          expect(await linksOf(c.id)).toEqual({ products: 1, coupons: 0 });
        }
      });
    });

    it('banner thứ 6 cùng chỗ bị cảnh báo chồng banner theo đúng thứ tự hiển thị thật', async () => {
      for (let i = 0; i < 5; i++) await admin.create(base(`day${i}`, { placement: 'OFFERS_TOP', sortOrder: i }));
      const sixth = await admin.create(base('day5', { placement: 'OFFERS_TOP', sortOrder: 9999 }));
      expect(issuesOf(await admin.list('OFFERS_TOP'), sixth.id)).toEqual({ blockers: 0, warnings: 1 });
      const shown = (await pub.listPublic('OFFERS_TOP')).map((b) => b.slug);
      expect(shown.slice(0, 5)).not.toContain(sixth.slug);
    });
  });
});
