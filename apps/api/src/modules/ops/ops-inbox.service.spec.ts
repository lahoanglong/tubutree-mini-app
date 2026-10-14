import { OpsInboxService } from './ops-inbox.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MerchantFulfilmentService } from '../merchant/merchant-fulfilment.service';
import { OPEN_CUSTOMER_REFUND_STATUSES } from '../orders/refund-queue';
import { CONSIGNMENT_PENDING_LINK_WHERE } from '../merchant/merchant-pancake-link';

const build = (over: { products?: number; links?: number; slips?: number; settle?: number; refunds?: number } = {}) => {
  const zero = { count: jest.fn().mockResolvedValue(0) };
  const productCount = jest.fn().mockResolvedValue(over.products ?? 0);
  const linkCount = jest.fn().mockResolvedValue(over.links ?? 0);
  const payoutCount = jest.fn().mockResolvedValue(over.slips ?? 0);
  const refundCount = jest.fn().mockResolvedValue(over.refunds ?? 0);
  const prisma = {
    product: { count: productCount },
    order: zero,
    orderCustomerRefund: { count: refundCount },
    returnRequest: zero,
    dealerApplication: zero,
    dealerRewardClaim: zero,
    payout: zero,
    bottleReturn: zero,
    merchantPancakeLink: { count: linkCount },
    merchantPayout: { count: payoutCount },
    $queryRaw: jest.fn().mockResolvedValue([{ n: 0 }]),
  } as unknown as PrismaService;
  const merchant = {
    countOverdue: jest.fn().mockResolvedValue(0),
    countStoresToSettle: jest.fn().mockResolvedValue(over.settle ?? 0),
  } as unknown as MerchantFulfilmentService;
  return { svc: new OpsInboxService(prisma, merchant), productCount, linkCount, payoutCount, refundCount, merchant };
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
