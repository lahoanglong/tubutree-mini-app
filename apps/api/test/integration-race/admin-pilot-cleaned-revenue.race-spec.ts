import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { AdminReportsService } from '../../src/modules/admin/admin-reports.service';
import { ACCOUNTING_CSV_HEADERS, accountingCsvChunks } from '../../src/modules/admin/accounting-export/accounting-export';
import { PILOT_CLEANUP_ACTION } from '../../src/modules/admin/golive/golive-pilot';
import { resolveReportRange } from '../../src/modules/admin/report-range';
import { createOrder, createUser, warmPool } from './helpers';

/**
 * Đơn thử Giờ G đã dọn (sổ `admin_audit_logs` GOLIVE_PILOT_CLEANUP; đơn ARCHIVE đã giao/đã thu chỉ được ghi mã vào sổ, không đổi đơn) không là
 * doanh thu: tab Báo cáo (theo ngày × kênh, theo nguồn khách), KPI tổng quan và file kế toán đều góp 0đ cho các mã đó, Postgres THẬT. DB race giữ dữ
 * liệu giữa các lần chạy và dùng chung với spec khác, nên ca này so CHÊNH LỆCH trước/sau khi ghi sổ, trên khoảng ngày năm 2017 không spec nào dùng.
 */
describe('Đơn thử Giờ G đã dọn không vào doanh thu, GMV, báo cáo nguồn và file kế toán (real Postgres)', () => {
  let prisma: PrismaService;
  let reports: AdminReportsService;
  let admin: AdminService;
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const auditIds: string[] = [];
  // 05:00Z = 12:00 giờ VN ngày 14/02/2017.
  const DAY = new Date('2017-02-14T05:00:00Z');
  const RANGE = { from: '2017-02-14', to: '2017-02-14' };
  const SOURCE_RANGE = { from: '2017-02-13', to: '2017-02-15' };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    reports = new AdminReportsService(prisma);
    const none = {} as never;
    admin = new AdminService(prisma, none, none, none, none, none, none, none, none, none);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$transaction([
        prisma.adminAuditLog.deleteMany({ where: { id: { in: auditIds } } }),
        prisma.order.deleteMany({ where: { id: { in: orderIds } } }),
        prisma.user.deleteMany({ where: { id: { in: userIds } } }),
      ]);
    }
    await prisma?.$disconnect();
  });

  async function csvRows(range: { from: string; to: string }) {
    let body = '';
    for await (const chunk of accountingCsvChunks(prisma, resolveReportRange(range.from, range.to, { maxDays: 366 }))) body += chunk;
    return body
      .trimEnd()
      .split('\r\n')
      .slice(1)
      .map((line) => line.split(','));
  }
  const col = (name: (typeof ACCOUNTING_CSV_HEADERS)[number]) => ACCOUNTING_CSV_HEADERS.indexOf(name);

  it('ghi mã vào sổ dọn đơn thử: doanh thu, GMV, số đơn đã thu và KPI giảm đúng tổng hai đơn ARCHIVE; file kế toán ghi 0đ và vẫn khớp tab Báo cáo', async () => {
    const buyer = await createUser(prisma, { role: 'CUSTOMER', createdAt: DAY });
    userIds.push(buyer.id);
    const mk = async (over: Partial<Parameters<typeof createOrder>[1]>) => {
      const o = await createOrder(prisma, { userId: buyer.id, createdAt: DAY, source: 'checkout', platform: 'miniapp', ...over });
      orderIds.push(o.id);
      return o;
    };
    const archivedPaid = await mk({ status: 'DELIVERED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 450_000, subtotal: 450_000 });
    const archivedCod = await mk({ status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 199_000, subtotal: 199_000 });
    const cancelledPilot = await mk({ status: 'CANCELLED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 100_000, subtotal: 100_000 });
    const real = await mk({ status: 'DELIVERED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 299_000, subtotal: 299_000 });

    const before = await reports.revenueReport(RANGE);
    const beforeSource = await reports.sourceReport(SOURCE_RANGE, new Date('2017-03-30T00:00:00Z'));
    const beforeKpi = await admin.getDashboardStats();
    const beforeCsv = await csvRows(RANGE);

    const log = await prisma.adminAuditLog.create({
      data: {
        actorId: buyer.id,
        action: PILOT_CLEANUP_ACTION,
        targetType: 'ORDER',
        targetIds: [cancelledPilot.code, archivedPaid.code, archivedCod.code],
        payload: { cancelled: [cancelledPilot.code], archived: [archivedPaid.code, archivedCod.code] },
      },
      select: { id: true },
    });
    auditIds.push(log.id);

    const after = await reports.revenueReport(RANGE);
    const afterSource = await reports.sourceReport(SOURCE_RANGE, new Date('2017-03-30T00:00:00Z'));
    const afterKpi = await admin.getDashboardStats();
    const afterCsv = await csvRows(RANGE);

    const pilotTotal = 450_000 + 199_000;
    expect(before.totals.revenue - after.totals.revenue).toBe(pilotTotal);
    expect(before.totals.gross - after.totals.gross).toBe(pilotTotal);
    expect(before.totals.gmv - after.totals.gmv).toBe(pilotTotal);
    expect(before.totals.paidOrders - after.totals.paidOrders).toBe(2);
    expect(after.totals.orders).toBe(before.totals.orders);
    expect(before.byDay.reduce((s, d) => s + d.revenue, 0) - after.byDay.reduce((s, d) => s + d.revenue, 0)).toBe(pilotTotal);
    expect(beforeSource.totals.revenue - afterSource.totals.revenue).toBe(pilotTotal);
    expect(beforeKpi.totalRevenue - afterKpi.totalRevenue).toBe(pilotTotal);
    expect(beforeKpi.gmv - afterKpi.gmv).toBe(pilotTotal);

    const byCode = (rows: string[][]) => Object.fromEntries(rows.map((r) => [r[0], r]));
    const revenueCol = col('Doanh thu ghi nhận (VNĐ)');
    expect(byCode(beforeCsv)[archivedPaid.code]![revenueCol]).toBe('450000');
    expect(byCode(afterCsv)[archivedPaid.code]![revenueCol]).toBe('0');
    expect(byCode(afterCsv)[archivedCod.code]![revenueCol]).toBe('0');
    expect(byCode(afterCsv)[archivedPaid.code]![col('Loại đơn')]).toBe('Bán lẻ (đơn thử đã dọn)');
    expect(byCode(afterCsv)[real.code]![revenueCol]).toBe('299000');
    expect(byCode(afterCsv)[real.code]![col('Loại đơn')]).toBe('Bán lẻ');
    // Cộng cột Doanh thu ghi nhận của file trên cùng khoảng ngày ra đúng số Doanh thu của tab Báo cáo, trước và sau khi ghi sổ.
    const csvRevenue = (rows: string[][]) => rows.reduce((s, r) => s + Number(r[revenueCol]), 0);
    expect(csvRevenue(beforeCsv)).toBe(before.totals.revenue);
    expect(csvRevenue(afterCsv)).toBe(after.totals.revenue);
  });
});
