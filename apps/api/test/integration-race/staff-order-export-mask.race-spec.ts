import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { AdminController, ExportOrdersQuery } from '../../src/modules/admin/admin.controller';
import { createOrder, createUser, randCode } from './helpers';

/**
 * D1-05 + D1-17 trên Postgres THẬT: kế toán (STAFF KE_TOAN) xuất CSV đơn với bộ lọc mới vẫn chỉ thấy 3 số cuối SĐT khách,
 * người nhận và CTV; quản trị viên thấy đủ. Bộ lọc vẫn áp đúng (đơn ngoài bộ lọc không có trong file).
 */
describe('CSV đơn có bộ lọc: che SĐT khi người xuất không phải ADMIN (real Postgres)', () => {
  let prisma: PrismaService;
  let ctrl: AdminController;
  const phone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const masked = (p: string) => `${'*'.repeat(p.length - 3)}${p.slice(-3)}`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const admin = new AdminService(prisma, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    ctrl = new AdminController(admin, {} as never);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function exportAs(role: string, q: Partial<ExportOrdersQuery>): Promise<string> {
    let out = '';
    const res = {
      setHeader: () => undefined,
      write: (c: string) => ((out += c), true),
      end: () => undefined,
      destroy: (e: Error) => {
        throw e;
      },
    };
    await ctrl.exportOrders(Object.assign(new ExportOrdersQuery(), q), role, res as never);
    return out;
  }

  it('kế toán xuất đơn CTV đã thanh toán: SĐT khách, người nhận, CTV chỉ còn 3 số cuối; ADMIN thấy đủ', async () => {
    const tok = randCode(8);
    const [buyerPhone, recipientPhone, ctvPhone] = [phone(), phone(), phone()];
    const buyer = await createUser(prisma, { fullName: `Xuất ${tok}`, phone: buyerPhone });
    const ctv = await createUser(prisma, { role: 'AFFILIATE', fullName: `CTV ${tok}`, phone: ctvPhone });
    const shippingAddress = {
      recipient: 'Người nhận IT',
      phone: recipientPhone,
      street: '1 Duong IT',
      ward: 'Phuong IT',
      district: '',
      province: 'Ha Noi',
      provinceCode: '84_VN01',
      districtCode: '',
      wardCode: '00001',
    };
    const inFilter = await createOrder(prisma, {
      code: `ITX${tok}C`,
      userId: buyer.id,
      referrerUserId: ctv.id,
      platform: 'miniapp',
      paymentStatus: 'PAID',
      shippingAddress,
    });
    const outOfFilter = await createOrder(prisma, { code: `ITX${tok}R`, userId: buyer.id, paymentStatus: 'UNPAID', shippingAddress });
    const q = { search: tok, kind: 'ctv' as const, payment: 'PAID' as const, platform: 'miniapp' as const };

    const staffCsv = await exportAs('STAFF', q);
    expect(staffCsv).toContain(inFilter.code);
    expect(staffCsv).not.toContain(outOfFilter.code);
    expect(staffCsv).toContain(`Xuất ${tok}`);
    for (const p of [buyerPhone, recipientPhone, ctvPhone]) {
      expect(staffCsv).not.toContain(p);
      expect(staffCsv).toContain(masked(p));
    }

    const adminCsv = await exportAs('ADMIN', q);
    expect(adminCsv).toContain(inFilter.code);
    expect(adminCsv).not.toContain(outOfFilter.code);
    for (const p of [buyerPhone, recipientPhone, ctvPhone]) expect(adminCsv).toContain(p);
  });
});
