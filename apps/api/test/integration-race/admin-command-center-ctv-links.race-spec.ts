import { randomBytes } from 'node:crypto';
import type { CommissionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { loadCommandCenter } from '../../src/modules/admin/command-center';
import { PILOT_CLEANUP_ACTION } from '../../src/modules/admin/golive/golive-pilot';
import { CTV_LINK_CSV_HEADERS, NO_LINK_TARGET_LABEL, ctvLinkCsvChunks } from '../../src/modules/admin/ctv-link-export';
import { createOrder, createUser, warmPool } from './helpers';

/**
 * Thẻ điều phối trang "Hôm nay" và file "Hoa hồng CTV theo link" chạy SQL thô: kiểm trên Postgres thật để tên cột, so sánh enum và phép ghép
 * link ↔ đơn ↔ hoa hồng đúng. Đơn hôm nay đặt ở 15/6/2018 (giờ VN), khoảng chưa spec nào dùng. Hàng sắp hết và hoa hồng chờ chi là số toàn
 * bảng nên so phần tăng trước/sau khi dựng dữ liệu (race suite chạy tuần tự, maxWorkers 1).
 */
/** Tách một dòng CSV: ô trong nháy kép có thể chứa dấu phẩy và nháy lồng `""`. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

describe('Thẻ điều phối và CSV hoa hồng CTV theo link (real Postgres)', () => {
  let prisma: PrismaService;
  // Chỉ chữ cái, không có chữ số và không có "x": tag ghép vào tên sản phẩm không được khớp PACK_RE (catalog/product-compare.unit.ts).
  const tag = Array.from(randomBytes(8), (b) => 'abcdefghijklmnopqrstuvw'[b % 23]).join('');
  const userIds: string[] = [];
  const productIds: string[] = [];
  const auditIds: string[] = [];
  const config = (value: unknown) => ({ get: async <T>() => value as T });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma, 4);
  });

  afterAll(async () => {
    if (prisma) {
      const orderIds = (await prisma.order.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((o) => o.id);
      await prisma.$transaction([
        prisma.commission.deleteMany({ where: { orderId: { in: orderIds } } }),
        prisma.affiliateLink.deleteMany({ where: { userId: { in: userIds } } }),
        prisma.order.deleteMany({ where: { id: { in: orderIds } } }),
        prisma.variation.deleteMany({ where: { productId: { in: productIds } } }),
        prisma.product.deleteMany({ where: { id: { in: productIds } } }),
        prisma.user.deleteMany({ where: { id: { in: userIds } } }),
        prisma.adminAuditLog.deleteMany({ where: { id: { in: auditIds } } }),
      ]);
    }
    await prisma?.$disconnect();
  });

  const mkUser = async (data: Parameters<typeof createUser>[1] = {}) => {
    const u = await createUser(prisma, data);
    userIds.push(u.id);
    return u;
  };

  const mkProduct = async (name: string, data: Partial<Prisma.ProductUncheckedCreateInput>, variations: { stock: number; isActive?: boolean }[]) => {
    const p = await prisma.product.create({
      data: { brand: 'IT', slug: `it-cc-${tag}-${productIds.length}`, name: `${name} ${tag}`, description: 'IT', basePrice: 100_000, ...data },
    });
    productIds.push(p.id);
    for (const [i, v] of variations.entries()) {
      await prisma.variation.create({
        data: { productId: p.id, sku: `ITCC-${tag}-${productIds.length}-${i}`, name: `Loại ${i}`, attributes: {}, retailPrice: 100_000, stock: v.stock, isActive: v.isActive ?? true },
      });
    }
    return p;
  };

  const commission = (
    affiliateUserId: string,
    orderId: string,
    status: CommissionStatus,
    amount: number,
    base: number,
    extra: Partial<Prisma.CommissionUncheckedCreateInput> = {},
  ) => prisma.commission.create({ data: { affiliateUserId, orderId, orderTotal: base, commissionableTotal: base, rate: 10, amount, status, ...extra } });

  it('đơn hôm nay chia đúng nhóm tiền; hàng sắp hết chỉ đếm biến thể đang bán của kho Tubu; hoa hồng chờ chi theo trạng thái', async () => {
    // 2018-06-15 05:00Z = 12:00 giờ VN; ngày VN 15/6 = [14/6 17:00Z, 15/6 17:00Z).
    const now = new Date('2018-06-15T05:00:00Z');
    const T = new Date('2018-06-15T03:00:00Z');
    const before = await loadCommandCenter(prisma, config(true), now);
    expect(before.ordersToday.total).toBe(0);

    const buyer = await mkUser();
    const mk = (createdAt: Date, over: Partial<Prisma.OrderUncheckedCreateInput>) => createOrder(prisma, { userId: buyer.id, createdAt, ...over });
    await mk(T, { status: 'CONFIRMED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 300_000 });
    await mk(T, { status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', total: 150_000 });
    await mk(T, { status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 200_000 });
    await mk(T, { type: 'DEALER', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 3_000_000 });
    await mk(T, { status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 100_000 });
    await mk(T, { status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 80_000 });
    await mk(T, { status: 'CANCELLED', paymentMethod: 'ZALOPAY', paymentStatus: 'REFUNDED', total: 50_000 });
    await mk(T, { status: 'CANCELLED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 60_000 });
    await mk(T, { status: 'PENDING_PAYMENT', paymentMethod: 'ZALOPAY', paymentStatus: 'UNPAID', total: 40_000 });
    await mk(T, { status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID', fulfiller: 'MERCHANT', total: 70_000 });
    const pilot = await mk(T, { status: 'DELIVERED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 20_000 });
    auditIds.push(
      (await prisma.adminAuditLog.create({ data: { actorId: buyer.id, action: PILOT_CLEANUP_ACTION, targetType: 'ORDER', targetIds: [pilot.code], payload: {} } })).id,
    );
    // Ngoài ngày: 23:59:59 hôm trước và đúng 00:00 hôm sau (giờ VN).
    await mk(new Date('2018-06-14T16:59:59Z'), { status: 'CONFIRMED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 7_000_000 });
    await mk(new Date('2018-06-15T17:00:00Z'), { status: 'CONFIRMED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 7_000_000 });

    await mkProduct('Nước giặt', {}, [{ stock: 0 }, { stock: 3 }, { stock: 5 }, { stock: 6 }, { stock: 1, isActive: false }]);
    await mkProduct('Ẩn', { isActive: false }, [{ stock: 1 }]);
    await mkProduct('Chờ duyệt', { approvalStatus: 'PENDING_REVIEW' }, [{ stock: 1 }]);
    await mkProduct('Đối tác tự giao', { fulfilment: 'MERCHANT' }, [{ stock: 1 }]);

    const ctv = await mkUser({ role: 'AFFILIATE' });
    const delivered = () => createOrder(prisma, { userId: buyer.id, status: 'DELIVERED', paymentMethod: 'COD', total: 100_000 });
    await commission(ctv.id, (await delivered()).id, 'APPROVED', 10_000, 100_000);
    await commission(ctv.id, (await createOrder(prisma, { userId: buyer.id, status: 'CONFIRMED' })).id, 'APPROVED', 7_000, 70_000);
    await commission(ctv.id, (await delivered()).id, 'APPROVED', 9_000, 90_000, { payoutBatchId: `legacy-${tag}` });
    await commission(ctv.id, (await delivered()).id, 'LOCKED', 5_000, 50_000);
    await commission(ctv.id, (await createOrder(prisma, { userId: buyer.id, status: 'SHIPPING' })).id, 'PENDING', 3_000, 30_000);
    await commission(ctv.id, (await delivered()).id, 'PAID', 100_000, 1_000_000);
    await commission(ctv.id, (await delivered()).id, 'REJECTED', 200_000, 2_000_000);

    const after = await loadCommandCenter(prisma, config(true), now);
    expect(after.ordersToday).toEqual({
      total: 11,
      paid: { count: 2, amount: 450_000 },
      bankTransferUnpaid: { count: 2, amount: 3_200_000 },
      cod: { count: 2, amount: 180_000 },
      merchantCod: { count: 1, amount: 70_000 },
      cancelled: { count: 2, amount: 110_000 },
      pilot: { count: 1, amount: 20_000 },
      other: { count: 1, amount: 40_000 },
    });
    expect(after.lowStock.threshold).toBe(5);
    expect(after.lowStock.count - before.lowStock.count).toBe(3);
    expect(after.lowStock.outOfStock - before.lowStock.outOfStock).toBe(1);
    expect(after.lowStock.items.length).toBeLessThanOrEqual(5);
    const stocks = after.lowStock.items.map((i) => i.stock);
    expect([...stocks].sort((a, b) => a - b)).toEqual(stocks);
    expect(stocks.every((s) => s <= 5)).toBe(true);
    expect(after.ctvPayouts.approvedAmount - before.ctvPayouts.approvedAmount).toBe(10_000);
    expect(after.ctvPayouts.approvedCtvs - before.ctvPayouts.approvedCtvs).toBe(1);
    expect(after.ctvPayouts.holdingAmount - before.ctvPayouts.holdingAmount).toBe(5_000);
    expect(after.ctvPayouts.pendingAmount - before.ctvPayouts.pendingAmount).toBe(3_000);
    expect(after.ctvPayouts.withdrawingAmount - before.ctvPayouts.withdrawingAmount).toBe(9_000);
    expect(after.ctvPayouts.autoWalletTransfer).toBe(true);
  });

  it('CSV theo link: đơn ghép đúng link của người hưởng; đơn không link hoặc mang link của người khác vào dòng "Không qua link"; bỏ hoa hồng REJECTED', async () => {
    const buyer = await mkUser();
    const lan = await mkUser({ role: 'AFFILIATE', fullName: `Lan ${tag}`, phone: `09${String(Date.now()).slice(-8)}` });
    const hung = await mkUser({ role: 'DEALER', fullName: `Hùng ${tag}` });
    const product = await mkProduct('Can nước rửa', {}, [{ stock: 50 }]);
    const home = await prisma.affiliateLink.create({ data: { userId: lan.id, shortCode: `cc${tag}a`, targetType: 'HOMEPAGE', clicks: 12, createdAt: new Date('2026-11-01T01:00:00Z') } });
    const pdp = await prisma.affiliateLink.create({
      data: { userId: lan.id, shortCode: `cc${tag}b`, targetType: 'PRODUCT', targetId: product.id, clicks: 4, createdAt: new Date('2026-11-02T01:00:00Z') },
    });
    const hungLink = await prisma.affiliateLink.create({ data: { userId: hung.id, shortCode: `cc${tag}c`, targetType: 'DEAL', clicks: 3 } });

    const order = (linkCode: string | null, status: Prisma.OrderUncheckedCreateInput['status'] = 'DELIVERED') =>
      createOrder(prisma, { userId: buyer.id, status, affiliateLinkCode: linkCode });
    await commission(lan.id, (await order(home.shortCode)).id, 'PAID', 30_000, 300_000);
    await commission(lan.id, (await order(home.shortCode)).id, 'LOCKED', 10_000, 100_000);
    await commission(lan.id, (await order(home.shortCode, 'CANCELLED')).id, 'REJECTED', 99_000, 990_000);
    await commission(lan.id, (await order(null)).id, 'APPROVED', 5_000, 50_000);
    // Đơn mang mã link của Hùng nhưng hoa hồng thuộc Lan (dữ liệu lệch): không được cộng vào link của Hùng.
    await commission(lan.id, (await order(hungLink.shortCode, 'SHIPPING')).id, 'PENDING', 2_000, 20_000);

    let csv = '';
    for await (const chunk of ctvLinkCsvChunks(prisma)) csv += chunk;
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe(CTV_LINK_CSV_HEADERS.join(','));
    const col = (name: string) => CTV_LINK_CSV_HEADERS.indexOf(name);
    const mine = lines
      .slice(1)
      .map(parseCsvLine)
      .filter((cells) => cells[0] === lan.id || cells[0] === hung.id);
    const lanRows = [
      [lan.id, home.shortCode, 'Trang chủ'],
      [lan.id, pdp.shortCode, `Sản phẩm: Can nước rửa ${tag}`],
      [lan.id, '', NO_LINK_TARGET_LABEL],
    ];
    const hungRows = [[hung.id, hungLink.shortCode, 'Giờ vàng']];
    // Người theo mã tăng dần; trong một người: link theo ngày tạo, rồi dòng "Không qua link".
    expect(mine.map((c) => [c[0], c[col('Mã link')], c[col('Đích link')]])).toEqual(lan.id < hung.id ? [...lanRows, ...hungRows] : [...hungRows, ...lanRows]);
    const byLink = new Map(mine.map((c) => [`${c[0]}|${c[col('Mã link')]}`, c]));
    const nums = (c: string[]) => c.slice(col('Lượt bấm'));

    expect(nums(byLink.get(`${lan.id}|${home.shortCode}`)!)).toEqual(['12', '2', '400000', '0', '10000', '0', '30000', '40000']);
    expect(nums(byLink.get(`${lan.id}|${pdp.shortCode}`)!)).toEqual(['4', '0', '0', '0', '0', '0', '0', '0']);
    expect(nums(byLink.get(`${lan.id}|`)!)).toEqual(['', '2', '70000', '2000', '0', '5000', '0', '7000']);
    expect(nums(byLink.get(`${hung.id}|${hungLink.shortCode}`)!)).toEqual(['3', '0', '0', '0', '0', '0', '0', '0']);
    expect(byLink.get(`${hung.id}|${hungLink.shortCode}`)![col('Vai trò')]).toBe('Đại lý');
    expect(byLink.get(`${lan.id}|${home.shortCode}`)![col('SĐT CTV')]).toBe(`="${lan.phone}"`);
  });
});
