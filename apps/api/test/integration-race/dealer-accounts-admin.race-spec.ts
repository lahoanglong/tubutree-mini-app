import { Test, type TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { DealerAccountsAdminService } from '../../src/modules/dealer/dealer-accounts-admin.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { createDealer, createOrder, createUser, randCode, summarize, warmPool } from './helpers';

/**
 * D1-06: danh sách đại lý kèm công nợ và sửa bậc đại lý trên Postgres THẬT: số liệu công nợ/doanh số tính trong SQL phải khớp
 * sổ, sửa bậc ghi lịch sử đúng thứ tự dù nhiều admin sửa cùng lúc, và mã bậc trùng không tạo được hai lần.
 */
describe('DealerAccountsAdminService (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: DealerAccountsAdminService;
  let dealer: DealerService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        DealerService,
        DealerAccountsAdminService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = moduleRef.get(DealerAccountsAdminService);
    dealer = moduleRef.get(DealerService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const uniquePhone = () => `08${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const tierBody = { name: 'Bậc IT', minOrderVolume: 10_000_000, discountPct: 20, creditLimit: 5_000_000, paymentTerms: 'NET 15' };
  const newTierId = () => `IT_${randCode(8)}`;

  describe('bậc đại lý', () => {
    it('tạo bậc rồi sửa: lưu phân số, ghi lịch sử CREATE/UPDATE đúng cũ → mới, không đổi thì không ghi', async () => {
      const id = newTierId();
      const admin = await createUser(prisma, { role: 'ADMIN', fullName: 'Admin IT' });
      const created = await svc.createTier(admin.id, { id, ...tierBody });
      expect(created).toMatchObject({ id, discountPct: 20, creditLimit: 5_000_000 });
      const row = await prisma.dealerTier.findUniqueOrThrow({ where: { id } });
      expect(row.discountRules).toEqual({ default: 0.2 });

      const edited = { ...tierBody, discountPct: 32.5, creditLimit: 8_000_000, paymentTerms: 'NET 30' };
      const updated = await svc.updateTier(admin.id, id, edited, tierBody);
      expect(updated).toMatchObject({ discountPct: 32.5, creditLimit: 8_000_000, paymentTerms: 'NET 30' });
      expect((await prisma.dealerTier.findUniqueOrThrow({ where: { id } })).discountRules).toEqual({ default: 0.325 });
      await svc.updateTier(admin.id, id, edited, edited);

      const history = await prisma.dealerTierHistory.findMany({ where: { tierId: id }, orderBy: { changedAt: 'asc' } });
      expect(history.map((h) => h.action)).toEqual(['CREATE', 'UPDATE']);
      expect(history[0]!.oldValue).toBeNull();
      expect(history[1]!.oldValue).toMatchObject({ discountPct: 20, creditLimit: 5_000_000 });
      expect(history[1]!.newValue).toMatchObject({ discountPct: 32.5, creditLimit: 8_000_000, paymentTerms: 'NET 30' });
      expect(history.every((h) => h.changedBy === admin.id)).toBe(true);

      const feed = await svc.tierHistory(200);
      expect(feed.find((h) => h.tierId === id && h.action === 'UPDATE')?.changedBy).toMatchObject({ id: admin.id, fullName: 'Admin IT' });
    });

    it('chiết khấu vượt dealer.max_discount_pct (mặc định 45%) bị chặn, DB không đổi, không ghi lịch sử', async () => {
      const id = newTierId();
      const admin = await createUser(prisma, { role: 'ADMIN' });
      await svc.createTier(admin.id, { id, ...tierBody });
      await expect(svc.updateTier(admin.id, id, { ...tierBody, discountPct: 46 }, tierBody)).rejects.toThrow(/vượt trần 45%/);
      expect((await prisma.dealerTier.findUniqueOrThrow({ where: { id } })).discountRules).toEqual({ default: 0.2 });
      expect(await prisma.dealerTierHistory.count({ where: { tierId: id } })).toBe(1);
    });

    it('6 admin cùng mở form một phiên bản rồi lưu đồng thời: đúng một người ghi được, 5 người nhận 409, DB là giá trị của người thắng, một dòng lịch sử', async () => {
      const id = newTierId();
      const admin = await createUser(prisma, { role: 'ADMIN' });
      await svc.createTier(admin.id, { id, ...tierBody });
      const limits = [1, 2, 3, 4, 5, 6].map((n) => n * 1_000_000);
      const results = await Promise.allSettled(limits.map((creditLimit, i) => svc.updateTier(`admin-${i}`, id, { ...tierBody, creditLimit }, tierBody)));
      const s = summarize(results);
      expect(s.fulfilled).toHaveLength(1);
      expect(s.rejected).toHaveLength(5);
      s.rejected.forEach((r) => expect(r.reason).toBeInstanceOf(ConflictException));
      const history = await prisma.dealerTierHistory.findMany({ where: { tierId: id, action: 'UPDATE' } });
      expect(history).toHaveLength(1);
      const row = await prisma.dealerTier.findUniqueOrThrow({ where: { id } });
      expect(row.creditLimit).toBe((history[0]!.newValue as { creditLimit: number }).creditLimit);
      expect(limits).toContain(row.creditLimit);
    });

    it('sửa nối tiếp, mỗi lần mang phiên bản vừa thấy: chuỗi lịch sử liền mạch (cũ của dòng sau = mới của dòng trước)', async () => {
      const id = newTierId();
      const admin = await createUser(prisma, { role: 'ADMIN' });
      await svc.createTier(admin.id, { id, ...tierBody });
      let seen = { ...tierBody };
      for (const creditLimit of [1, 2, 3].map((n) => n * 1_000_000)) {
        const next = { ...seen, creditLimit };
        await svc.updateTier(admin.id, id, next, seen);
        seen = next;
      }
      const history = await prisma.dealerTierHistory.findMany({ where: { tierId: id, action: 'UPDATE' }, orderBy: [{ changedAt: 'asc' }, { id: 'asc' }] });
      expect(history.map((h) => [(h.oldValue as { creditLimit: number }).creditLimit, (h.newValue as { creditLimit: number }).creditLimit])).toEqual([
        [5_000_000, 1_000_000],
        [1_000_000, 2_000_000],
        [2_000_000, 3_000_000],
      ]);
    });

    it('A mở form, B hạ hạn mức, A chỉ đổi tên: A nhận 409, hạn mức của B còn nguyên, không có dòng lịch sử của A', async () => {
      const id = newTierId();
      const admin = await createUser(prisma, { role: 'ADMIN' });
      await svc.createTier(admin.id, { id, ...tierBody });
      const seenByA = { ...tierBody };
      await svc.updateTier(admin.id, id, { ...tierBody, creditLimit: 1_000_000 }, seenByA);

      await expect(svc.updateTier('admin-a', id, { ...tierBody, name: 'Bậc đổi tên' }, seenByA)).rejects.toThrow(/vừa được người khác sửa/);
      const row = await prisma.dealerTier.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ name: tierBody.name, creditLimit: 1_000_000 });
      const history = await prisma.dealerTierHistory.findMany({ where: { tierId: id, action: 'UPDATE' } });
      expect(history).toHaveLength(1);
      expect(history[0]!.changedBy).toBe(admin.id);

      await expect(svc.updateTier('admin-a', id, { ...tierBody, name: 'Bậc đổi tên', creditLimit: 1_000_000 }, { ...tierBody, creditLimit: 1_000_000 })).resolves.toMatchObject({
        name: 'Bậc đổi tên',
        creditLimit: 1_000_000,
      });
    });

    it('3 admin tạo cùng mã bậc đồng thời: đúng một người tạo được, hai người còn lại nhận 409; chỉ một dòng lịch sử CREATE', async () => {
      const id = newTierId();
      const results = await Promise.allSettled([1, 2, 3].map((i) => svc.createTier(`admin-${i}`, { id, ...tierBody })));
      const s = summarize(results);
      expect(s.fulfilled).toHaveLength(1);
      s.rejected.forEach((r) => expect(r.reason).toBeInstanceOf(ConflictException));
      expect(await prisma.dealerTierHistory.count({ where: { tierId: id, action: 'CREATE' } })).toBe(1);
    });

    it('listTiers đếm đại lý theo bậc và đại lý chưa gán bậc', async () => {
      const id = newTierId();
      const admin = await createUser(prisma, { role: 'ADMIN' });
      await svc.createTier(admin.id, { id, ...tierBody });
      await createDealer(prisma, { metadata: { dealerTierId: id } });
      await createDealer(prisma, { metadata: { dealerTierId: id } });
      const before = (await svc.listTiers()).dealersWithoutTier;
      await createDealer(prisma);
      const out = await svc.listTiers();
      expect(out.tiers.find((t) => t.id === id)).toMatchObject({ dealerCount: 2, discountPct: 20 });
      expect(out.dealersWithoutTier).toBe(before + 1);
      expect(out.maxDiscountPct).toBe(45);
    });
  });

  describe('danh sách đại lý và công nợ', () => {
    const NOW = new Date('2026-10-15T05:00:00Z');

    async function seed() {
      const tok = randCode(8);
      const tierId = newTierId();
      await prisma.dealerTier.create({
        data: { id: tierId, name: `Bậc ${tok}`, minOrderVolume: 0, discountRules: { default: 0.3 }, creditLimit: 5_000_000, paymentTerms: 'NET 15' },
      });
      const mk = (label: string, extra: Record<string, unknown> = {}) =>
        createDealer(prisma, { fullName: `Đại lý ${tok} ${label}`, phone: uniquePhone(), ...extra });
      const a = await mk('A', { metadata: { dealerTierId: tierId } });
      const b = await mk('B');
      const c = await mk('C', { metadata: { dealerTierId: tierId } });
      const ledger = (userId: string, delta: number, refType: string, refId?: string) =>
        prisma.dealerCreditLedger.create({ data: { userId, delta, refType, refId: refId ?? null, note: 'IT' } });

      // A: nợ 4tr (6tr ghi nợ - 2tr đã trả) qua một đơn công nợ đã đóng gói + 210 dòng nhỏ để vượt giới hạn 200 dòng.
      const creditOrder = await createOrder(prisma, {
        userId: a.id, type: 'DEALER', status: 'PACKED', paymentStatus: 'UNPAID', paymentMethod: 'BANK_TRANSFER', total: 2_000_000, createdAt: new Date('2026-10-05T03:00:00Z'),
      });
      await ledger(a.id, 2_000_000, 'ORDER', creditOrder.id);
      await ledger(a.id, 4_000_000, 'QUARTER_BONUS_ADJ', `adj-${tok}`);
      await ledger(a.id, -2_000_000, 'PAYMENT');
      await prisma.dealerCreditLedger.createMany({
        data: Array.from({ length: 105 }, (_, i) => [
          { userId: a.id, delta: 1_000, refType: 'ADJ', refId: `p${tok}-${i}`, note: 'IT' },
          { userId: a.id, delta: -1_000, refType: 'ADJ', refId: `m${tok}-${i}`, note: 'IT' },
        ]).flat(),
      });
      const o = (userId: string, status: string, paymentStatus: string, total: number, createdAt: string) =>
        createOrder(prisma, { userId, type: 'DEALER', status: status as never, paymentStatus: paymentStatus as never, total, createdAt: new Date(createdAt) });
      await o(a.id, 'DELIVERED', 'PAID', 10_000_000, '2026-10-02T03:00:00Z'); // đã chốt
      await o(a.id, 'CONFIRMED', 'UNPAID', 3_000_000, '2026-10-03T03:00:00Z'); // chờ chốt
      await o(a.id, 'CANCELLED', 'UNPAID', 9_000_000, '2026-10-03T03:00:00Z'); // loại
      await o(a.id, 'DELIVERED', 'REFUNDED', 8_000_000, '2026-10-03T03:00:00Z'); // loại
      await o(a.id, 'DELIVERED', 'PAID', 7_000_000, '2026-09-30T16:59:59Z'); // 23:59:59 ngày 30/9 giờ VN: tháng trước
      await o(a.id, 'DELIVERED', 'PAID', 1_000_000, '2026-09-30T17:00:00Z'); // 00:00 ngày 1/10 giờ VN: tháng này
      await o(a.id, 'DELIVERED', 'PAID', 500_000, '2026-10-31T16:59:59Z'); // 23:59:59 ngày 31/10 giờ VN: tháng này
      await o(a.id, 'DELIVERED', 'PAID', 4_000_000, '2026-10-31T17:00:00Z'); // 00:00 ngày 1/11 giờ VN: tháng sau
      // C: vượt hạn mức 5tr (nợ 6tr).
      await ledger(c.id, 6_000_000, 'ORDER', `ord-${tok}`);
      return { tok, tierId, a, b, c, creditOrder };
    }

    it('dư nợ cộng cả sổ (không cắt ở 200 dòng), doanh số tháng theo giờ VN, nợ nhiều nhất trước, tổng nợ khớp', async () => {
      const s = await seed();
      const out = await svc.listAccounts({ page: 1, limit: 20, search: s.tok }, NOW);
      expect(out.data.map((d) => d.userId)).toEqual([s.c.id, s.a.id, s.b.id]);
      const [c, a, b] = out.data;
      expect(c).toMatchObject({ debt: 6_000_000, creditLimit: 5_000_000, overLimit: true, tier: { id: s.tierId } });
      expect(a).toMatchObject({
        debt: 4_000_000,
        overLimit: false,
        // 10tr đã trả + 1tr + 500k + 2tr đơn công nợ đã đóng gói = đã chốt; 3tr đơn chưa trả = chờ chốt
        monthSales: 13_500_000,
        monthPending: 3_000_000,
        monthOrders: 5,
      });
      expect(b).toMatchObject({ debt: 0, creditLimit: 0, overLimit: false, tier: null, monthSales: 0, monthPending: 0, monthOrders: 0 });
      expect(out.meta).toEqual({ page: 1, limit: 20, total: 3 });
      expect(out.summary).toEqual({ totalDebt: 10_000_000, debtors: 2 });
      expect(out.month).toBe('2026-10');
    });

    it('sổ tổng của panel (creditLedger) cũng cộng đủ mọi dòng, không chỉ 200 dòng gần nhất', async () => {
      const s = await seed();
      const ledger = await dealer.creditLedger(s.a.id);
      expect(ledger.balance).toBe(4_000_000);
      expect(ledger.entries.length).toBeLessThanOrEqual(200);
    });

    it('lọc còn nợ, theo bậc, theo SĐT; phân trang không mất dòng và total đúng', async () => {
      const s = await seed();
      const debtors = await svc.listAccounts({ page: 1, limit: 20, search: s.tok, debtOnly: true }, NOW);
      expect(debtors.data.map((d) => d.userId)).toEqual([s.c.id, s.a.id]);
      expect(debtors.meta.total).toBe(2);
      const byTier = await svc.listAccounts({ page: 1, limit: 20, tierId: s.tierId }, NOW);
      expect(byTier.data.map((d) => d.userId)).toEqual([s.c.id, s.a.id]);
      const phone = (await prisma.user.findUniqueOrThrow({ where: { id: s.b.id } })).phone!;
      const byPhone = await svc.listAccounts({ page: 1, limit: 20, search: phone }, NOW);
      expect(byPhone.data.map((d) => d.userId)).toContain(s.b.id);
      const p1 = await svc.listAccounts({ page: 1, limit: 2, search: s.tok }, NOW);
      const p2 = await svc.listAccounts({ page: 2, limit: 2, search: s.tok }, NOW);
      expect([...p1.data, ...p2.data].map((d) => d.userId)).toEqual([s.c.id, s.a.id, s.b.id]);
      expect(p2.meta.total).toBe(3);
    });

    it('chỉ role DEALER: khách thường và CTV cùng tên không lọt vào danh sách', async () => {
      const s = await seed();
      await createUser(prisma, { fullName: `Đại lý ${s.tok} D`, role: 'CUSTOMER' });
      await createUser(prisma, { fullName: `Đại lý ${s.tok} E`, role: 'AFFILIATE' });
      const out = await svc.listAccounts({ page: 1, limit: 20, search: s.tok }, NOW);
      expect(out.meta.total).toBe(3);
    });

    it('chuỗi tìm có ký tự đặc biệt (% _) không khớp tràn', async () => {
      const s = await seed();
      const out = await svc.listAccounts({ page: 1, limit: 20, search: `${s.tok}%` }, NOW);
      expect(out.meta.total).toBe(0);
    });
  });
});
