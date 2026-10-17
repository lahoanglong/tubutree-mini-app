import { OpsInboxService } from './ops-inbox.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MerchantFulfilmentService } from '../merchant/merchant-fulfilment.service';
import { OPEN_CUSTOMER_REFUND_STATUSES } from '../orders/refund-queue';
import { CONSIGNMENT_PENDING_LINK_WHERE } from '../merchant/merchant-pancake-link';
import { buildAdminOrderWhere } from '../admin/admin-order-filter';
import type { SystemConfigService } from '../system-config/system-config.service';

const build = (
  over: { products?: number; links?: number; slips?: number; settle?: number; refunds?: number; communityPending?: number; unanswered?: number; invoices?: number; config?: Record<string, unknown> } = {},
) => {
  const zero = { count: jest.fn().mockResolvedValue(0) };
  const orderCount = jest.fn().mockResolvedValue(over.invoices ?? 0);
  const postCount = jest.fn().mockResolvedValue(over.communityPending ?? 0);
  // returnsToReceive dùng template literal (đối số đầu là mảng chuỗi); câu hỏi chưa trả lời dùng Prisma.sql.
  const queryRaw = jest.fn((q: unknown) => Promise.resolve([{ n: !Array.isArray(q) && String((q as { sql: string }).sql).includes('feed_posts') ? (over.unanswered ?? 0) : 0 }]));
  const config = { get: jest.fn(async (key: string, fallback?: unknown) => (over.config && key in over.config ? over.config[key] : fallback)) };
  const productCount = jest.fn().mockResolvedValue(over.products ?? 0);
  const linkCount = jest.fn().mockResolvedValue(over.links ?? 0);
  const payoutCount = jest.fn().mockResolvedValue(over.slips ?? 0);
  const refundCount = jest.fn().mockResolvedValue(over.refunds ?? 0);
  const prisma = {
    product: { count: productCount },
    order: { count: orderCount },
    feedPost: { count: postCount },
    orderCustomerRefund: { count: refundCount },
    returnRequest: zero,
    dealerApplication: zero,
    dealerRewardClaim: zero,
    payout: zero,
    bottleReturn: zero,
    merchantPancakeLink: { count: linkCount },
    merchantPayout: { count: payoutCount },
    $queryRaw: queryRaw,
  } as unknown as PrismaService;
  const merchant = {
    countOverdue: jest.fn().mockResolvedValue(0),
    countStoresToSettle: jest.fn().mockResolvedValue(over.settle ?? 0),
  } as unknown as MerchantFulfilmentService;
  return { svc: new OpsInboxService(prisma, merchant, config as unknown as SystemConfigService), productCount, linkCount, payoutCount, refundCount, merchant, orderCount, postCount, queryRaw };
};

describe('OpsInboxService — merchantProducts', () => {
  it('R3-MERCHANT-4: đếm cả sản phẩm đang bán có bản sửa chờ duyệt, cùng điều kiện với màn Duyệt SP đối tác', async () => {
    const { svc, productCount } = build({ products: 3 });

    const res = await svc.counts({ role: 'ADMIN' });

    expect(res.items.find((i) => i.key === 'merchantProducts')?.count).toBe(3);
    expect(productCount).toHaveBeenCalledWith({
      where: { OR: [{ approvalStatus: 'PENDING_REVIEW' }, { editDraft: { isNot: null } }] },
    });
  });
});

describe('OpsInboxService — customerRefunds', () => {
  it('R4-ADMIN-3: đếm đúng tập "Đang mở" của hàng đợi Hoàn tiền khách (một nguồn với bộ lọc và huy hiệu tab)', async () => {
    const { svc, refundCount } = build({ refunds: 4 });

    const res = await svc.counts({ role: 'ADMIN' });

    expect(res.items.find((i) => i.key === 'customerRefunds')?.count).toBe(4);
    expect(refundCount).toHaveBeenCalledWith({ where: { status: { in: [...OPEN_CUSTOMER_REFUND_STATUSES] } } });
    expect([...OPEN_CUSTOMER_REFUND_STATUSES]).toEqual(['UNVERIFIED', 'PENDING', 'PROCESSING']);
  });
});

describe('OpsInboxService — việc với đối tác (R4-ADMIN-7)', () => {
  it('đếm liên kết ký gửi (takeover) đang chờ admin xác nhận, cùng điều kiện với bộ lọc ở màn Duyệt SP đối tác', async () => {
    const { svc, linkCount } = build({ links: 2 });

    const res = await svc.counts({ role: 'ADMIN' });

    expect(res.items.find((i) => i.key === 'consignmentPending')?.count).toBe(2);
    expect(linkCount).toHaveBeenCalledWith({ where: CONSIGNMENT_PENDING_LINK_WHERE });
    expect(CONSIGNMENT_PENDING_LINK_WHERE).toEqual({ takeover: true, consignmentConfirmedAt: null, unlinkedAt: null });
  });

  it('đếm gian hàng có khoản đã đủ hạn chờ lập phiếu và phiếu đối soát đang chờ chuyển/thu', async () => {
    const { svc, payoutCount, merchant } = build({ settle: 3, slips: 4 });
    const now = new Date('2026-10-14T03:00:00.000Z');

    const res = await svc.counts({ role: 'ADMIN' }, now);

    expect(res.items.find((i) => i.key === 'merchantToSettle')?.count).toBe(3);
    expect(res.items.find((i) => i.key === 'merchantPayoutsPending')?.count).toBe(4);
    expect(merchant.countStoresToSettle).toHaveBeenCalledWith(now);
    expect(payoutCount).toHaveBeenCalledWith({ where: { status: 'PENDING' } });
  });

  it('chỉ ADMIN thấy các việc này; nhân viên không thấy và không tốn truy vấn đếm', async () => {
    const { svc, linkCount, payoutCount, merchant } = build({ links: 1, slips: 1, settle: 1 });

    const staff = await svc.counts({ role: 'STAFF', staffPermissions: ['CSKH', 'KHO'] });

    const keys = staff.items.map((i) => i.key);
    expect(keys).not.toContain('consignmentPending');
    expect(keys).not.toContain('merchantToSettle');
    expect(keys).not.toContain('merchantPayoutsPending');
    expect(linkCount).not.toHaveBeenCalled();
    expect(payoutCount).not.toHaveBeenCalled();
    expect(merchant.countStoresToSettle).not.toHaveBeenCalled();
  });
});

describe('OpsInboxService — cộng đồng và hoá đơn VAT (launch review D1-08, D1-17)', () => {
  const count = (res: { items: { key: string; count: number }[] }, key: string) => res.items.find((i) => i.key === key)?.count;

  it('communityPending: đếm bài PENDING, đúng điều kiện hàng chờ ở tab Cộng đồng', async () => {
    const { svc, postCount } = build({ communityPending: 5 });

    const res = await svc.counts({ role: 'ADMIN' });

    expect(count(res, 'communityPending')).toBe(5);
    expect(postCount).toHaveBeenCalledWith({ where: { status: 'PENDING' } });
  });

  it('communityUnanswered: đếm câu hỏi chưa ai trả lời quá 24 giờ (mặc định) theo giờ của lần gọi', async () => {
    const { svc, queryRaw } = build({ unanswered: 3 });
    const now = new Date('2026-10-17T12:00:00.000Z');

    const res = await svc.counts({ role: 'ADMIN' }, now);

    expect(count(res, 'communityUnanswered')).toBe(3);
    const call = queryRaw.mock.calls.map((c) => c[0] as { sql?: string; values?: unknown[] }).find((q) => !Array.isArray(q) && q.sql?.includes('feed_posts'))!;
    expect(call.values).toEqual([new Date('2026-10-16T12:00:00.000Z')]);
  });

  it('communityUnanswered: khoá community.unanswered_alert_hours đổi ngưỡng', async () => {
    const { svc, queryRaw } = build({ config: { 'community.unanswered_alert_hours': 12 } });

    await svc.counts({ role: 'ADMIN' }, new Date('2026-10-17T12:00:00.000Z'));

    const call = queryRaw.mock.calls.map((c) => c[0] as { sql?: string; values?: unknown[] }).find((q) => !Array.isArray(q) && q.sql?.includes('feed_posts'))!;
    expect(call.values).toEqual([new Date('2026-10-17T00:00:00.000Z')]);
  });

  it('invoicePending: đếm đơn VAT chờ xuất bằng ĐÚNG điều kiện bộ lọc "VAT chờ xuất" của tab Đơn hàng', async () => {
    const { svc, orderCount } = build({ invoices: 2 });

    const res = await svc.counts({ role: 'ADMIN' });

    expect(count(res, 'invoicePending')).toBe(2);
    expect(orderCount).toHaveBeenCalledWith({ where: buildAdminOrderWhere({ invoice: 'pending' }) });
    expect(buildAdminOrderWhere({ invoice: 'pending' })).toEqual({
      invoiceStatus: { in: ['REQUESTED', 'FAILED'] },
      status: { notIn: ['CANCELLED', 'RETURNED'] },
    });
  });

  it('CSKH thấy 2 khoá cộng đồng nhưng không thấy VAT (xuất hoá đơn chỉ ADMIN); không tốn truy vấn cho khoá không thấy', async () => {
    const { svc, postCount, queryRaw } = build({ communityPending: 1, unanswered: 1, invoices: 1 });

    const res = await svc.counts({ role: 'STAFF', staffPermissions: ['CSKH'] });

    const keys = res.items.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['communityPending', 'communityUnanswered']));
    expect(keys).not.toContain('invoicePending');
    expect(postCount).toHaveBeenCalledTimes(1);
    expect(queryRaw.mock.calls.some((c) => !Array.isArray(c[0]) && (c[0] as { sql: string }).sql.includes('feed_posts'))).toBe(true);
  });

  it('KHO và nhân viên chưa có nhóm không thấy khoá cộng đồng, và các truy vấn đếm không chạy', async () => {
    const { svc, postCount, queryRaw } = build({ communityPending: 1, unanswered: 1 });

    const kho = await svc.counts({ role: 'STAFF', staffPermissions: ['KHO'] });
    const none = await svc.counts({ role: 'STAFF', staffPermissions: [] });

    for (const res of [kho, none]) {
      const keys = res.items.map((i) => i.key);
      expect(keys).not.toContain('communityPending');
      expect(keys).not.toContain('communityUnanswered');
    }
    expect(postCount).not.toHaveBeenCalled();
    expect(queryRaw.mock.calls.some((c) => !Array.isArray(c[0]) && (c[0] as { sql: string }).sql.includes('feed_posts'))).toBe(false);
  });
});
