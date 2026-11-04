import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { createOrder, createUser, randCode, summarize, warmPool } from './helpers';

/** C-094: admin ghi nhận "đã xuất hoá đơn VAT" trên Postgres thật (enum nullable + guard atomic + bộ lọc danh sách). */
describe('AdminService.issueOrderInvoice (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let admin: AdminService;
  let webhook: { onInvoiceIssued(data: Record<string, unknown>): Promise<void> };
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    admin = new AdminService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      { notify, notifySafe: notify } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    webhook = new PancakeProcessor(prisma, { notify, notifySafe: notify } as never, {} as never, { alert: jest.fn() } as never) as unknown as typeof webhook;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const REQUEST = { taxCode: '0312345678', companyName: 'Cty IT', address: '1 Duong IT', email: 'kt@it.vn' };

  it('5 admin cùng xuất một đơn REQUESTED -> đúng 1 người ghi + báo khách; invoiceUrl là của người thắng', async () => {
    notify.mockClear();
    const u = await createUser(prisma, {});
    const o = await createOrder(prisma, { userId: u.id, status: 'DELIVERED', invoiceRequest: REQUEST, invoiceStatus: 'REQUESTED' });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => admin.issueOrderInvoice(`admin${i}`, o.code, { invoiceUrl: `https://hd.meinvoice.vn/${i}` })),
    );
    const s = summarize(results);
    const row = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    console.log('[invoice] fulfilled=%d rejected=%d status=%s url=%s errors=%j', s.fulfilled.length, s.rejected.length, row.invoiceStatus, row.invoiceUrl, [...new Set(s.errors)]);
    expect(s.fulfilled).toHaveLength(1);
    expect(s.rejected).toHaveLength(4);
    s.rejected.forEach((r) => expect(r.reason).toBeInstanceOf(BadRequestException));
    expect(row.invoiceStatus).toBe('ISSUED');
    expect(row.invoiceUrl).toBe(s.fulfilled[0]!.value.order.invoiceUrl);
    expect(notify.mock.calls.filter((c) => c[1] === 'INVOICE_ISSUED')).toHaveLength(1);
  });

  it('admin bấm "Đã xuất hoá đơn" cùng lúc với 2 webhook invoice.issued -> khách nhận đúng 1 tin, link là của bên thắng', async () => {
    for (let round = 0; round < 8; round++) {
      notify.mockClear();
      const u = await createUser(prisma, {});
      const pancakeOrderId = `pk-${randCode()}`;
      const o = await createOrder(prisma, {
        userId: u.id, status: 'DELIVERED', invoiceRequest: REQUEST, invoiceStatus: 'REQUESTED', pancakeOrderId,
        invoiceUrl: 'https://hd.meinvoice.vn/cu',
      });
      const [byAdmin, ...byHook] = await Promise.allSettled([
        admin.issueOrderInvoice('admin1', o.code, { invoiceUrl: 'https://hd.meinvoice.vn/admin' }),
        webhook.onInvoiceIssued({ id: pancakeOrderId, invoice_url: 'https://hd.meinvoice.vn/pk1' }),
        webhook.onInvoiceIssued({ id: pancakeOrderId, invoice_url: 'https://hd.meinvoice.vn/pk2' }),
      ]);
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
      byHook.forEach((r) => expect(r.status).toBe('fulfilled'));
      expect(row.invoiceStatus).toBe('ISSUED');
      expect(notify.mock.calls.filter((c) => c[1] === 'INVOICE_ISSUED')).toHaveLength(1);
      if (byAdmin.status === 'fulfilled') {
        expect(row.invoiceUrl).toBe('https://hd.meinvoice.vn/admin');
      } else {
        expect(byAdmin.reason).toBeInstanceOf(BadRequestException);
        expect(row.invoiceUrl).toMatch(/^https:\/\/hd\.meinvoice\.vn\/pk[12]$/);
      }
    }
  });

  it('cột invoiceStatus NULL (dữ liệu cũ) mà có invoiceRequest vẫn xuất được; đơn không có yêu cầu thì bị từ chối', async () => {
    const u = await createUser(prisma, {});
    const legacy = await createOrder(prisma, { userId: u.id, status: 'DELIVERED', invoiceRequest: REQUEST });
    await prisma.$executeRaw`UPDATE "orders" SET "invoiceStatus" = NULL WHERE id = ${legacy.id}`;
    const out = await admin.issueOrderInvoice('admin1', legacy.id, {});
    expect(out.order.invoiceStatus).toBe('ISSUED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: legacy.id } })).invoiceStatus).toBe('ISSUED');

    const plain = await createOrder(prisma, { userId: u.id, status: 'DELIVERED' });
    await expect(admin.issueOrderInvoice('admin1', plain.code, {})).rejects.toThrow(/chưa có yêu cầu/i);
  });

  it('listOrders lọc theo invoice: pending chỉ REQUESTED/FAILED, issued chỉ ISSUED, bỏ đơn không yêu cầu', async () => {
    const phone = `09${String(Date.now()).slice(-8)}`;
    const u = await createUser(prisma, { phone });
    const mk = (invoiceStatus: 'REQUESTED' | 'ISSUED' | 'FAILED' | 'NOT_REQUESTED') =>
      createOrder(prisma, {
        userId: u.id,
        invoiceStatus,
        ...(invoiceStatus === 'NOT_REQUESTED' ? {} : { invoiceRequest: REQUEST }),
      });
    const [req, iss, fail, none] = await Promise.all([mk('REQUESTED'), mk('ISSUED'), mk('FAILED'), mk('NOT_REQUESTED')]);
    const codesOf = async (filter: 'pending' | 'issued' | 'all') => {
      const page = await admin.listOrders(1, 200, undefined, phone, undefined, filter);
      return page.data.filter((o) => o.userId === u.id).map((o) => o.code);
    };
    const pending = await codesOf('pending');
    const issued = await codesOf('issued');
    const all = await codesOf('all');
    expect(new Set(pending)).toEqual(new Set([req.code, fail.code]));
    expect(new Set(issued)).toEqual(new Set([iss.code]));
    expect(new Set(all)).toEqual(new Set([req.code, iss.code, fail.code]));
    expect(all).not.toContain(none.code);
  });

  it('đơn HUỶ/TRẢ chưa xuất hoá đơn không nằm trong hàng đợi pending (và số đếm meta.total), đơn đã ISSUED thì vẫn tra được', async () => {
    const phone = `09${String(Date.now()).slice(-8)}`;
    const u = await createUser(prisma, { phone });
    const mk = (status: 'CONFIRMED' | 'CANCELLED' | 'RETURNED', invoiceStatus: 'REQUESTED' | 'ISSUED' | 'FAILED') =>
      createOrder(prisma, { userId: u.id, status, invoiceStatus, invoiceRequest: REQUEST });
    const [open, cancelled, returned, failedCancelled, issuedCancelled] = await Promise.all([
      mk('CONFIRMED', 'REQUESTED'),
      mk('CANCELLED', 'REQUESTED'),
      mk('RETURNED', 'REQUESTED'),
      mk('CANCELLED', 'FAILED'),
      mk('CANCELLED', 'ISSUED'),
    ]);
    const pageOf = (filter: 'pending' | 'issued' | 'all') => admin.listOrders(1, 200, undefined, phone, undefined, filter);
    const pending = await pageOf('pending');
    const all = await pageOf('all');
    const issued = await pageOf('issued');
    const mine = (p: { data: { userId: string; code: string }[] }) => new Set(p.data.filter((o) => o.userId === u.id).map((o) => o.code));
    console.log('[invoice] pending=%j total=%d', [...mine(pending)], pending.meta.total);
    expect(mine(pending)).toEqual(new Set([open.code]));
    expect(pending.meta.total).toBe(1);
    expect(mine(all)).toEqual(new Set([open.code, issuedCancelled.code]));
    expect(mine(issued)).toEqual(new Set([issuedCancelled.code]));
    for (const o of [cancelled, returned, failedCancelled]) expect(mine(pending)).not.toContain(o.code);
  });
});
