import { randomInt } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { createOrder, createUser, randCode } from './helpers';

/**
 * Danh sách / CSV đơn admin trên Postgres THẬT (UAT vòng 4): tìm theo người nhận và SĐT người nhận thiếu số 0, mã Pancake
 * dán kèm '#', ký tự % và _ khớp đúng nghĩa đen (đơn, người dùng, mã giảm giá).
 */
describe('Admin orders — tìm kiếm và trạng thái hoàn tiền (real Postgres)', () => {
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

  type Listed = { id: string; customerRefunds?: { method: string; status: string; amount: number }[] };
  const list = async (search: string) =>
    ((await admin.listOrders(1, 50, undefined, search)) as unknown as { data: Listed[] }).data;
  const ids = async (search: string) => (await list(search)).map((o) => o.id).sort();
  const csvOf = async (search: string) => {
    let csv = '';
    for await (const c of await admin.orderCsv({ search })) csv += c;
    return csv;
  };

  it('R4-ADMIN-4: tìm theo tên người nhận (có dấu, một phần, không dấu, hoa), SĐT người nhận thiếu số 0, mã Pancake có "#"', async () => {
    const tok = randCode(6);
    const num = String(randomInt(10_000_000, 99_999_999));
    const buyer = await createUser(prisma, { fullName: `Người Mua ${randCode(6)}` });
    const recipientPhone = `09${num}`;
    const gift = await createOrder(prisma, {
      userId: buyer.id,
      code: `ITR${randCode(8)}`,
      pancakeOrderId: `77${num}`,
      shippingAddress: { recipient: `Nguyễn Thị Mẹ Chồng ${tok}`, phone: recipientPhone, street: '1', ward: 'W', district: '', province: 'HN' },
    });
    await createOrder(prisma, { userId: buyer.id, code: `ITR${randCode(8)}` });

    expect(await ids(`Nguyễn Thị Mẹ Chồng ${tok}`)).toEqual([gift.id]);
    expect(await ids(`Mẹ Chồng ${tok}`)).toEqual([gift.id]);
    expect(await ids(`nguyen thi me chong ${tok.toLowerCase()}`)).toEqual([gift.id]);
    expect(await ids(`MẸ CHỒNG ${tok}`)).toEqual([gift.id]);
    expect(await ids(recipientPhone.slice(1))).toEqual([gift.id]);
    expect(await ids(`+84${recipientPhone.slice(1)}`)).toEqual([gift.id]);
    expect(await ids(`#77${num}`)).toEqual([gift.id]);
    expect(await ids(` # 77${num} `)).toEqual([gift.id]);
    expect(await ids(`#${gift.code}`)).toEqual([gift.id]);
    expect(await csvOf(`Mẹ Chồng ${tok}`)).toContain(gift.code);
  });

  it('R4-ADMIN-4: tên người nhận lưu dạng NFD / có khoảng trắng lạ vẫn tìm được; sửa địa chỉ thì cột tìm theo', async () => {
    const tok = randCode(6);
    const buyer = await createUser(prisma, {});
    const o = await createOrder(prisma, {
      userId: buyer.id,
      shippingAddress: { recipient: `Trần\u00a0Văn Hoà ${tok}`.normalize('NFD'), phone: '0900000000', street: '1', ward: 'W', district: '', province: 'HN' },
    });
    expect(await ids(`tran van hoa ${tok.toLowerCase()}`)).toEqual([o.id]);
    await prisma.order.update({
      where: { id: o.id },
      data: { shippingAddress: { recipient: `Lê Thị Bông ${tok}`, phone: '0900000000', street: '1', ward: 'W', district: '', province: 'HN' } },
    });
    expect(await ids(`tran van hoa ${tok.toLowerCase()}`)).toEqual([]);
    expect(await ids(`Bông ${tok}`)).toEqual([o.id]);
    const [idx] = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'orders_recipientSearch_trgm_idx'`;
    expect(idx?.indexdef).toMatch(/USING gin \("recipientSearch" gin_trgm_ops\)/);
  });

  it('R4-ADMIN-5: % và _ trong ô tìm đơn khớp đúng nghĩa đen, không phải ký tự đại diện', async () => {
    const tok = randCode(6);
    const buyer = await createUser(prisma, { fullName: `Khách ${tok}x` });
    const plain = await createOrder(prisma, { userId: buyer.id, code: `ITW${tok}AX` });
    const under = await createOrder(prisma, { userId: buyer.id, code: `ITW${tok}_X` });

    expect(await ids(`ITW${tok}%X`)).toEqual([]);
    expect(await ids(`ITW${tok}_X`)).toEqual([under.id]);
    expect(await ids(`ITW${tok}`)).toEqual([plain.id, under.id].sort());
    expect(await ids(`Khách ${tok}%`)).toEqual([]);
    expect(await ids(`Khách ${tok}_`)).toEqual([]);
    expect(await ids(`${tok}\\`)).toEqual([]);
    const csv = await csvOf(`ITW${tok}%X`);
    expect(csv.trimEnd().split('\r\n')).toHaveLength(1);
  });

  it('R4-ADMIN-5: % và _ trong ô tìm người dùng và mã giảm giá khớp đúng nghĩa đen', async () => {
    const tok = randCode(6);
    const u = await createUser(prisma, { fullName: `Người ${tok}x` });
    const usersOf = async (s: string) =>
      ((await admin.listUsers(1, 50, s)) as unknown as { data: { id: string }[] }).data.map((r) => r.id);
    expect(await usersOf(`${tok}x`)).toEqual([u.id]);
    expect(await usersOf(`${tok}%`)).toEqual([]);
    expect(await usersOf(`${tok}_`)).toEqual([]);

    const now = Date.now();
    const coupon = await prisma.coupon.create({
      data: {
        code: `ITC${tok.toUpperCase()}A`,
        type: 'AMOUNT',
        value: 10_000,
        scope: 'PUBLIC',
        startAt: new Date(now - 3_600_000),
        endAt: new Date(now + 3_600_000),
      },
    });
    const couponsOf = async (q: string) =>
      ((await admin.listCoupons({ page: 1, limit: 50, q })) as unknown as { data: { id: string }[] }).data.map((r) => r.id);
    expect(await couponsOf(`ITC${tok}A`)).toEqual([coupon.id]);
    expect(await couponsOf(`ITC${tok}%`)).toEqual([]);
    expect(await couponsOf(`ITC${tok}_`)).toEqual([]);
  });
});
