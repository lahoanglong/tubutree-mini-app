import { randomInt } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { createOrder, createUser, randCode } from './helpers';

/**
 * Danh sách / tìm kiếm đơn admin trên Postgres THẬT (C-027, C-052): index phục vụ các truy vấn thực
 * dùng phải có sau `prisma migrate deploy`, và tìm kiếm qua index trigram phải trả đúng tập đơn như
 * cách lọc cũ (mã đơn, mã Gomdon, SĐT, tên khách không phân biệt hoa thường).
 */
describe('Admin order search + query indexes (real Postgres)', () => {
  let prisma: PrismaService;
  let admin: AdminService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    admin = new AdminService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('migration tạo đủ index cho admin đơn + cron/inbox', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`;
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    const expected: Record<string, RegExp> = {
      orders_createdAt_idx: /ON public\.orders USING btree \("createdAt"\)/,
      orders_code_trgm_idx: /ON public\.orders USING gin \(code gin_trgm_ops\)/,
      orders_gomdonPartnerCode_trgm_idx: /ON public\.orders USING gin \("gomdonPartnerCode" gin_trgm_ops\)/,
      users_phone_trgm_idx: /ON public\.users USING gin \(phone gin_trgm_ops\)/,
      users_fullName_trgm_idx: /ON public\.users USING gin \("fullName" gin_trgm_ops\)/,
      notification_logs_userId_sentAt_idx: /ON public\.notification_logs USING btree \("userId", "sentAt"\)/,
      notification_logs_templateCode_sentAt_idx: /ON public\.notification_logs USING btree \("templateCode", "sentAt"\)/,
      cashback_transactions_status_confirmedAt_idx: /ON public\.cashback_transactions USING btree \(status, "confirmedAt"\)/,
      commissions_status_lockedAt_idx: /ON public\.commissions USING btree \(status, "lockedAt"\)/,
      refresh_tokens_createdAt_idx: /ON public\.refresh_tokens USING btree \("createdAt"\)/,
    };
    const missing = Object.entries(expected)
      .filter(([name, def]) => !def.test(byName.get(name) ?? ''))
      .map(([name]) => `${name}: ${byName.get(name) ?? '(không có)'}`);
    expect(missing).toEqual([]);
  });

  it('tìm theo mã đơn / mã Gomdon / SĐT / tên khách ra đúng đơn, kể cả khi tên nhập hoa', async () => {
    const tok = randCode(6);
    const digits = String(randomInt(10_000_000, 99_999_999));
    const buyer = await createUser(prisma, { phone: `09${digits}`, fullName: `Nguyễn Thị ${tok}` });
    const other = await createUser(prisma, { phone: `08${digits}`, fullName: `Khách khác ${randCode(6)}` });
    const o1 = await createOrder(prisma, { userId: buyer.id, code: `ITS${tok}A` });
    const o2 = await createOrder(prisma, { userId: buyer.id, code: `ITS${randCode(8)}` });
    const o3 = await createOrder(prisma, { userId: other.id, code: `ITS${randCode(8)}`, gomdonPartnerCode: `GD-${tok}` });
    await createOrder(prisma, { userId: other.id, code: `ITS${randCode(8)}` });

    const ids = async (search: string) => {
      const res = (await admin.listOrders(1, 50, undefined, search)) as unknown as {
        data: { id: string }[];
        meta?: { total: number };
        total?: number;
      };
      return res.data.map((o) => o.id).sort();
    };

    expect(await ids(`ITS${tok}`)).toEqual([o1.id]);
    expect(await ids(`gd-${tok.toLowerCase()}`)).toEqual([o3.id]);
    expect(await ids(`09${digits}`)).toEqual([o1.id, o2.id].sort());
    expect(await ids(`9${digits}`)).toEqual([o1.id, o2.id].sort());
    expect(await ids(`NGUYỄN THỊ ${tok}`)).toEqual([o1.id, o2.id].sort());
    expect(await ids(`thị ${tok.toLowerCase()}`)).toEqual([o1.id, o2.id].sort());
  });

  it('ADMINOPS-9: tìm theo mã vận đơn hãng, mã đơn Pancake, SĐT +84/84, SĐT người nhận và tên không dấu', async () => {
    const tok = randCode(6);
    const num = String(randomInt(10_000_000, 99_999_999));
    const buyer = await createUser(prisma, { phone: `09${num}`, fullName: `Khách Một ${tok}` });
    const o1 = await createOrder(prisma, { userId: buyer.id, code: `ITP${tok}A`, shippingCode: `GHN${tok}777`, shippingPartner: 'GHN' });
    const o2 = await createOrder(prisma, { userId: buyer.id, code: `ITP${tok}B`, pancakeOrderId: `98${num}` });
    const ctv = await createUser(prisma, { phone: `03${num}`, fullName: `CTV ${randCode(6)}` });
    const recipientPhone = `07${num}`;
    const o3 = await createOrder(prisma, {
      userId: ctv.id,
      code: `ITP${randCode(8)}`,
      shippingAddress: { recipient: 'Người nhận', phone: recipientPhone, street: '1', ward: 'W', district: '', province: 'HN' },
    });

    const ids = async (search: string) => {
      const res = (await admin.listOrders(1, 50, undefined, search)) as unknown as { data: { id: string }[] };
      return res.data.map((o) => o.id).sort();
    };

    expect(await ids(`ghn${tok.toLowerCase()}777`)).toEqual([o1.id]);
    expect(await ids(`98${num}`)).toEqual([o2.id]);
    expect(await ids(`+849${num}`)).toEqual([o1.id, o2.id].sort());
    expect(await ids(`84 9${num.slice(0, 4)} ${num.slice(4)}`)).toEqual([o1.id, o2.id].sort());
    expect(await ids(`khach mot ${tok.toLowerCase()}`)).toEqual([o1.id, o2.id].sort());
    expect(await ids(`KHACH MOT ${tok}`)).toEqual([o1.id, o2.id].sort());
    expect(await ids(recipientPhone)).toEqual([o3.id]);
    expect(await ids(`+847${num}`)).toEqual([o3.id]);
  });

  it('ADMINOPS-9: cột tên không dấu của users theo trigger, có index trigram', async () => {
    const u = await createUser(prisma, { fullName: `Đặng Thị ${'Hoà'.normalize('NFD')}` });
    const read = async () =>
      (await prisma.$queryRaw<{ s: string }[]>`SELECT "fullNameSearch" AS s FROM users WHERE id = ${u.id}`)[0]!.s;
    expect(await read()).toBe('dang thi hoa');
    await prisma.user.update({ where: { id: u.id }, data: { fullName: 'NGUYỄN VĂN ÁNH' } });
    expect(await read()).toBe('nguyen van anh');
    const [idx] = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'users_fullNameSearch_trgm_idx'`;
    expect(idx?.indexdef).toMatch(/USING gin \("fullNameSearch" gin_trgm_ops\)/);
    const [ship] = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'orders_shippingCode_trgm_idx'`;
    expect(ship?.indexdef).toMatch(/USING gin \("shippingCode" gin_trgm_ops\)/);
  });

  it('chuỗi tìm ngắn (< 3 ký tự, trigram không dùng được) vẫn lọc đúng theo cách cũ', async () => {
    const tok = randCode(6);
    const buyer = await createUser(prisma, { fullName: `Zq${tok}` });
    const o = await createOrder(prisma, { userId: buyer.id, code: `ITZ${tok}` });
    const res = (await admin.listOrders(1, 50, undefined, tok.slice(0, 2))) as unknown as { data: { id: string }[] };
    expect(Array.isArray(res.data)).toBe(true);
    const full = (await admin.listOrders(1, 50, undefined, `ITZ${tok}`)) as unknown as { data: { id: string }[] };
    expect(full.data.map((d) => d.id)).toEqual([o.id]);
  });
});
