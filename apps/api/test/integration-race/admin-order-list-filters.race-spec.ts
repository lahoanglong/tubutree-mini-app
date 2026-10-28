import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { createOrder, createUser, randCode } from './helpers';

/**
 * D1-17: bộ lọc danh sách đơn admin (loại đơn, thanh toán, nền tảng, CTV, gian hàng, thứ tự) trên Postgres THẬT.
 * Mọi đơn của ca đều thuộc một khách có tên mang `tok` duy nhất nên `search` cô lập khỏi đơn của spec khác.
 */
describe('Admin order list filters (real Postgres)', () => {
  let prisma: PrismaService;
  let admin: AdminService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    admin = new AdminService(prisma, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function seed() {
    const tok = randCode(8);
    const buyer = await createUser(prisma, { fullName: `Lọc ${tok}` });
    const ctv = await createUser(prisma, { role: 'AFFILIATE', fullName: `CTV ${tok}` });
    const slug = `it-lf-${tok.toLowerCase()}`;
    const store = await prisma.storefront.create({ data: { type: 'CTV', slug, ownerUserId: ctv.id, title: `Gian ${tok}`, isPublished: true } });
    const mk = (name: string, data: Parameters<typeof createOrder>[1]) =>
      createOrder(prisma, { ...data, code: `ITL${tok}${name}` }).then((o) => [name, o.code] as const);
    const entries = await Promise.all([
      mk('RET', { userId: buyer.id, platform: 'miniapp', paymentStatus: 'UNPAID' }),
      mk('RETW', { userId: buyer.id, platform: 'web', paymentStatus: 'PAID' }),
      mk('CTV', { userId: buyer.id, referrerUserId: ctv.id, platform: 'miniapp', paymentStatus: 'PAID' }),
      mk('STO', { userId: buyer.id, referrerUserId: ctv.id, storefrontId: store.id, storefrontSlug: slug, platform: 'web', paymentStatus: 'UNPAID' }),
      mk('STOM', { userId: buyer.id, storefrontId: store.id, storefrontSlug: slug, platform: 'miniapp', paymentStatus: 'REFUNDED' }),
      mk('ASS', { userId: ctv.id, referrerUserId: ctv.id, placedForCustomer: true, platform: 'miniapp', paymentStatus: 'PAID' }),
      mk('DLR', { userId: buyer.id, type: 'DEALER', platform: 'web', paymentStatus: 'FAILED' }),
    ]);
    const code = Object.fromEntries(entries) as Record<string, string>;
    return { tok, buyer, ctv, slug, code };
  }

  type Row = { code: string };
  const codesOf = async (search: string, extra: Parameters<AdminService['listOrders']>[10]) => {
    const page = (await admin.listOrders(1, 100, undefined, search, undefined, undefined, undefined, undefined, undefined, undefined, extra)) as unknown as {
      data: Row[];
      meta: { total: number };
    };
    return { codes: page.data.map((o) => o.code), total: page.meta.total };
  };

  it('loại đơn chia thành năm nhóm loại trừ nhau, đủ mọi đơn một lần', async () => {
    const s = await seed();
    const kinds = ['retail', 'ctv', 'dealer', 'ctv_assisted', 'storefront'] as const;
    const got = Object.fromEntries(await Promise.all(kinds.map(async (k) => [k, (await codesOf(s.tok, { kind: k })).codes] as const)));
    expect(new Set(got.retail)).toEqual(new Set([s.code.RET, s.code.RETW]));
    expect(new Set(got.ctv)).toEqual(new Set([s.code.CTV]));
    expect(new Set(got.dealer)).toEqual(new Set([s.code.DLR]));
    expect(new Set(got.ctv_assisted)).toEqual(new Set([s.code.ASS]));
    expect(new Set(got.storefront)).toEqual(new Set([s.code.STO, s.code.STOM]));
    const all = (await codesOf(s.tok, {})).codes;
    expect(all.sort()).toEqual(kinds.flatMap((k) => got[k]).sort());
  });

  it('tình trạng thanh toán và nền tảng lọc đúng, tổng meta.total khớp số dòng', async () => {
    const s = await seed();
    const paid = await codesOf(s.tok, { payment: 'PAID' });
    expect(new Set(paid.codes)).toEqual(new Set([s.code.RETW, s.code.CTV, s.code.ASS]));
    expect(paid.total).toBe(3);
    expect(new Set((await codesOf(s.tok, { payment: 'REFUNDED' })).codes)).toEqual(new Set([s.code.STOM]));
    expect(new Set((await codesOf(s.tok, { payment: 'FAILED' })).codes)).toEqual(new Set([s.code.DLR]));
    expect(new Set((await codesOf(s.tok, { payment: 'UNPAID' })).codes)).toEqual(new Set([s.code.RET, s.code.STO]));
    const web = await codesOf(s.tok, { platform: 'web' });
    expect(new Set(web.codes)).toEqual(new Set([s.code.RETW, s.code.STO, s.code.DLR]));
    expect(web.total).toBe(3);
    expect(new Set((await codesOf(s.tok, { platform: 'web', payment: 'PAID', kind: 'retail' })).codes)).toEqual(new Set([s.code.RETW]));
  });

  it('hàng đợi chuyển khoản chờ xác nhận: chỉ đơn lẻ chuyển khoản chưa trả, không lẫn ZaloPay, ví hay đơn đại lý', async () => {
    const tok = randCode(8);
    const buyer = await createUser(prisma, { fullName: `Hàng đợi ${tok}` });
    const mk = (name: string, data: Partial<Parameters<typeof createOrder>[1]>) =>
      createOrder(prisma, { userId: buyer.id, status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', paymentMethod: 'BANK_TRANSFER', ...data, code: `ITQ${tok}${name}` }).then((o) => o.code);
    const bank = await mk('BANK', {});
    await mk('ZALO', { paymentMethod: 'ZALOPAY' });
    await mk('WALLET', { paymentMethod: 'WALLET' });
    await mk('DLR', { type: 'DEALER' });
    await mk('PAID', { paymentStatus: 'PAID', status: 'CONFIRMED' });
    const got = await codesOf(tok, { queue: 'bank_transfer_to_confirm' });
    expect(got.codes).toEqual([bank]);
    expect(got.total).toBe(1);
    expect((await codesOf(tok, {})).total).toBe(5);
  });

  it('lọc theo CTV (id) và theo gian hàng (slug, subdomain hoa thường); slug lạ trả danh sách rỗng', async () => {
    const s = await seed();
    const byCtv = await codesOf(s.tok, { referrerUserId: s.ctv.id });
    expect(new Set(byCtv.codes)).toEqual(new Set([s.code.CTV, s.code.STO, s.code.ASS]));
    expect(new Set((await codesOf(s.tok, { storefront: s.slug.toUpperCase() })).codes)).toEqual(new Set([s.code.STO, s.code.STOM]));
    expect(new Set((await codesOf(s.tok, { storefront: s.slug, referrerUserId: s.ctv.id })).codes)).toEqual(new Set([s.code.STO]));
    const none = await codesOf(s.tok, { storefront: `khong-co-${s.tok}` });
    expect(none.codes).toEqual([]);
    expect(none.total).toBe(0);
  });

  it('đổi thứ tự: mặc định mới nhất trước, order=asc cũ nhất trước', async () => {
    const s = await seed();
    const t = (n: number) => new Date(Date.UTC(2026, 0, n, 3, 0, 0));
    await prisma.order.updateMany({ where: { code: s.code.RET }, data: { createdAt: t(3) } });
    await prisma.order.updateMany({ where: { code: s.code.RETW }, data: { createdAt: t(2) } });
    await prisma.order.updateMany({ where: { code: s.code.CTV }, data: { createdAt: t(1) } });
    const slice = (codes: string[]) => codes.filter((c) => [s.code.RET, s.code.RETW, s.code.CTV].includes(c));
    expect(slice((await codesOf(s.tok, {})).codes)).toEqual([s.code.RET, s.code.RETW, s.code.CTV]);
    expect(slice((await codesOf(s.tok, { order: 'asc' })).codes)).toEqual([s.code.CTV, s.code.RETW, s.code.RET]);
  });

  it('file CSV dùng đúng bộ lọc: cùng tập đơn với danh sách', async () => {
    const s = await seed();
    const f = { kind: 'storefront' as const, payment: 'UNPAID' as const, storefront: s.slug };
    let csv = '';
    for await (const c of await admin.orderCsv({ search: s.tok, ...f })) csv += c;
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(csv).toContain(s.code.STO);
    expect(csv).not.toContain(s.code.STOM);
    expect((await codesOf(s.tok, f)).codes).toEqual([s.code.STO]);
  });

  it('migration tạo đủ index cho bộ lọc mới', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'orders'`;
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    expect(byName.get('orders_paymentStatus_createdAt_idx')).toMatch(/\("paymentStatus", "createdAt"\)/);
    expect(byName.get('orders_type_createdAt_idx')).toMatch(/\(type, "createdAt"\)/);
    expect(byName.get('orders_platform_createdAt_idx')).toMatch(/\(platform, "createdAt"\)/);
    expect(byName.get('orders_placedForCustomer_createdAt_idx')).toMatch(/\("placedForCustomer", "createdAt"\)/);
  });
});
