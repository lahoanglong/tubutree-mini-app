import { OpsInboxService } from './ops-inbox.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MerchantFulfilmentService } from '../merchant/merchant-fulfilment.service';
import { OPEN_CUSTOMER_REFUND_STATUSES } from '../orders/refund-queue';
import { CONSIGNMENT_PENDING_LINK_WHERE } from '../merchant/merchant-pancake-link';
import { buildAdminOrderWhere } from '../admin/admin-order-filter';
import type { SystemConfigService } from '../system-config/system-config.service';
import {
  WASTE_PERKS_PENDING_WHERE,
  WASTE_POINTS_PENDING_WHERE,
  WASTE_TO_COUNT_WHERE,
  WASTE_UNMATCHED_OPEN_WHERE,
  wasteCustomerBlockedWhere,
  wasteGiftOverdueWhere,
  wasteOrderMismatchWhere,
  wasteTransitOverdueWhere,
} from '../waste-exchange/core/waste-queue-filters';

const build = (
  over: { products?: number; links?: number; slips?: number; settle?: number; refunds?: number; communityPending?: number; unanswered?: number; invoices?: number; toPay?: number; dealerPending?: number; dealerToPay?: number; extReview?: number; extAttempts?: number; extPartial?: number; extClosed?: number; extStuck?: number; config?: Record<string, unknown>; noConfig?: boolean; supportUnforwarded?: number; bridge?: { state: string; since: Date }; bridgeUrl?: string } = {},
) => {
  const zero = { count: jest.fn().mockResolvedValue(0) };
  const orderCount = jest.fn((args?: { where?: { paymentMethod?: string } }) => Promise.resolve(args?.where?.paymentMethod === 'BANK_TRANSFER' ? 0 : (over.invoices ?? 0)));
  const postCount = jest.fn().mockResolvedValue(over.communityPending ?? 0);
  // returnsToReceive dùng template literal (đối số đầu là mảng chuỗi); câu hỏi chưa trả lời dùng Prisma.sql.
  const queryRaw = jest.fn((q: unknown) => Promise.resolve([{ n: !Array.isArray(q) && String((q as { sql: string }).sql).includes('feed_posts') ? (over.unanswered ?? 0) : 0 }]));
  const config = { get: jest.fn(async (key: string, fallback?: unknown) => (over.config && key in over.config ? over.config[key] : key === 'chat.enabled' ? true : fallback)) };
  const productCount = jest.fn((args?: { where?: { images?: unknown } }) => Promise.resolve(args?.where?.images ? 0 : (over.products ?? 0)));
  const linkCount = jest.fn().mockResolvedValue(over.links ?? 0);
  const payoutCount = jest.fn().mockResolvedValue(over.slips ?? 0);
  const withdrawalCount = jest.fn((args: { where: { status: string } }) => Promise.resolve(args.where.status === 'APPROVED' ? (over.toPay ?? 0) : 0));
  const refundCount = jest.fn().mockResolvedValue(over.refunds ?? 0);
  const dealerClaimCount = jest.fn((args: { where: { status: string } }) =>
    Promise.resolve(args.where.status === 'APPROVED' ? (over.dealerToPay ?? 0) : args.where.status === 'PENDING' ? (over.dealerPending ?? 0) : 0),
  );
  const extClaimCount = jest.fn((args: { where: { state: string; reviewReason?: unknown; OR?: unknown } }) =>
    Promise.resolve(args.where.state === 'REVIEW' ? (over.extReview ?? 0) : args.where.reviewReason ? (over.extPartial ?? 0) : args.where.OR ? (over.extStuck ?? 0) : (over.extClosed ?? 0)),
  );
  const extAttemptCount = jest.fn().mockResolvedValue(over.extAttempts ?? 0);
  const wasteReqCount = jest.fn().mockResolvedValue(0);
  const unmatchedCount = jest.fn().mockResolvedValue(0);
  const pointCount = jest.fn().mockResolvedValue(0);
  const giftCount = jest.fn().mockResolvedValue(0);
  const supportConvCount = jest.fn().mockResolvedValue(over.supportUnforwarded ?? 0);
  const bridgeFind = jest.fn().mockResolvedValue(over.bridge ?? null);
  const prisma = {
    product: { count: productCount },
    order: { count: orderCount, findFirst: jest.fn().mockResolvedValue(null) },
    storefront: { count: jest.fn().mockResolvedValue(0) },
    communityReport: { count: jest.fn().mockResolvedValue(0) },
    feedPost: { count: postCount },
    orderCustomerRefund: { count: refundCount },
    returnRequest: zero,
    dealerApplication: zero,
    dealerRewardClaim: { count: dealerClaimCount },
    payout: { count: withdrawalCount },
    wasteRequest: { count: wasteReqCount },
    wasteUnmatchedParcel: { count: unmatchedCount },
    wastePoint: { count: pointCount },
    wasteGiftRedemption: { count: giftCount },
    merchantPancakeLink: { count: linkCount },
    merchantPayout: { count: payoutCount },
    externalPointsClaim: { count: extClaimCount },
    externalClaimAttempt: { count: extAttemptCount },
    supportConversation: { count: supportConvCount },
    supportBridgeStatus: { findUnique: bridgeFind },
    $queryRaw: queryRaw,
  } as unknown as PrismaService;
  const merchant = {
    countOverdue: jest.fn().mockResolvedValue(0),
    countStoresToSettle: jest.fn().mockResolvedValue(over.settle ?? 0),
  } as unknown as MerchantFulfilmentService;
  const svc = new OpsInboxService(prisma, merchant, over.noConfig ? undefined : (config as unknown as SystemConfigService), { get: () => over.bridgeUrl ?? 'http://bridge:3110' } as never);
  return { svc, config, dealerClaimCount, productCount, linkCount, payoutCount, withdrawalCount, refundCount, merchant, orderCount, postCount, queryRaw, extClaimCount, extAttemptCount, wasteReqCount, unmatchedCount, pointCount, giftCount, supportConvCount, bridgeFind };
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

  it('KE_TOAN thấy VAT chờ xuất (kế toán bấm "Đã xuất hoá đơn"), đếm cùng điều kiện với ADMIN', async () => {
    const { svc, orderCount } = build({ invoices: 3 });

    const res = await svc.counts({ role: 'STAFF', staffPermissions: ['KE_TOAN'] });

    expect(count(res, 'invoicePending')).toBe(3);
    expect(orderCount).toHaveBeenCalledWith({ where: buildAdminOrderWhere({ invoice: 'pending' }) });
  });

  it('CSKH thấy 2 khoá cộng đồng nhưng không thấy VAT (việc của kế toán); không tốn truy vấn cho khoá không thấy', async () => {
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

describe('OpsInboxService — externalPoints', () => {
  it('cộng claim chờ duyệt, lần gửi mã quá hạn tự ghép, claim đã cộng mà đơn hoàn một phần claim đã cộng mà đơn đã đóng và claim PENDING không bao giờ tới hạn', async () => {
    const { svc, extAttemptCount, extClaimCount } = build({ extReview: 2, extAttempts: 3, extPartial: 1, extClosed: 4, extStuck: 5 });

    const res = await svc.counts({ role: 'ADMIN' }, new Date('2026-10-20T00:00:00.000Z'));

    expect(res.items.find((i) => i.key === 'externalPoints')?.count).toBe(15);
    expect(extClaimCount).toHaveBeenCalledWith({ where: { state: 'REVIEW' } });
    expect(extClaimCount).toHaveBeenCalledWith({ where: { state: 'CREDITED', externalOrder: { status: { in: ['CANCELLED', 'RETURNED', 'DELETED'] } } } });
    expect(extClaimCount).toHaveBeenCalledWith({ where: { state: 'CREDITED', reviewReason: { not: null } } });
    expect(extAttemptCount).toHaveBeenCalledWith({
      where: {
        result: 'UNMATCHED',
        resolvedAt: null,
        OR: [{ externalOrderId: { not: null } }, { createdAt: { lt: new Date('2026-10-17T00:00:00.000Z') } }],
      },
    });
  });

  it('KE_TOAN và KHO không thấy khoá này (CSKH và ADMIN xử lý)', async () => {
    for (const perms of [['KE_TOAN'], ['KHO'], []]) {
      const res = await build().svc.counts({ role: 'STAFF', staffPermissions: perms });
      expect(res.items.map((i) => i.key)).not.toContain('externalPoints');
    }
  });
});

describe('OpsInboxService — payoutsToPay', () => {
  const count = (res: { items: { key: string; count: number }[] }, key: string) => res.items.find((i) => i.key === key)?.count;

  it('đếm lệnh rút tiền ADMIN đã duyệt, chờ kế toán bấm "Đã chi"; ADMIN và KE_TOAN thấy, các nhóm khác không', async () => {
    const { svc, withdrawalCount } = build({ toPay: 5 });

    const accountant = await svc.counts({ role: 'STAFF', staffPermissions: ['KE_TOAN'] });
    expect(count(accountant, 'payoutsToPay')).toBe(5);
    expect(withdrawalCount).toHaveBeenCalledWith({ where: { status: 'APPROVED' } });
    expect(count(await svc.counts({ role: 'ADMIN' }), 'payoutsToPay')).toBe(5);

    for (const perms of [['CSKH'], ['KHO'], ['MARKETING'], []]) {
      const res = await build({ toPay: 5 }).svc.counts({ role: 'STAFF', staffPermissions: perms });
      expect(res.items.map((i) => i.key)).not.toContain('payoutsToPay');
    }
  });
});

describe('OpsInboxService — dealerClaimsToPay', () => {
  const count = (res: { items: { key: string; count: number }[] }, key: string) => res.items.find((i) => i.key === key)?.count;

  it('đếm thưởng đại lý ADMIN đã duyệt, chờ kế toán bấm "Đã chi" (mark-paid cho KE_TOAN); ADMIN và KE_TOAN thấy, các nhóm khác không', async () => {
    const { svc, dealerClaimCount } = build({ dealerToPay: 3, dealerPending: 7 });

    const accountant = await svc.counts({ role: 'STAFF', staffPermissions: ['KE_TOAN'] });
    expect(count(accountant, 'dealerClaimsToPay')).toBe(3);
    expect(dealerClaimCount).toHaveBeenCalledWith({ where: { status: 'APPROVED' } });
    expect(count(await svc.counts({ role: 'ADMIN' }), 'dealerClaimsToPay')).toBe(3);

    for (const perms of [['CSKH'], ['KHO'], ['MARKETING'], []]) {
      const res = await build({ dealerToPay: 3 }).svc.counts({ role: 'STAFF', staffPermissions: perms });
      expect(res.items.map((i) => i.key)).not.toContain('dealerClaimsToPay');
    }
  });

  it('khoá dealerClaims (chờ DUYỆT) vẫn chỉ đếm PENDING và chỉ ADMIN thấy; kế toán không thấy việc duyệt', async () => {
    const { svc } = build({ dealerToPay: 3, dealerPending: 7 });

    expect(count(await svc.counts({ role: 'ADMIN' }), 'dealerClaims')).toBe(7);
    const accountant = await svc.counts({ role: 'STAFF', staffPermissions: ['KE_TOAN'] });
    expect(accountant.items.map((i) => i.key)).not.toContain('dealerClaims');
  });
});

describe('OpsInboxService — mỗi nhóm việc chỉ thấy hàng đợi mình xử lý được (D1-05)', () => {
  const keysFor = async (perms: string[]) => (await build().svc.counts({ role: 'STAFF', staffPermissions: perms })).items.map((i) => i.key).sort();

  it('MARKETING: chỉ hai hàng đợi cộng đồng (cùng CSKH) và hai hàng đợi đổi rác của mọi nhân viên', async () => {
    expect(await keysFor(['MARKETING'])).toEqual(['communityPending', 'communityReports', 'communityUnanswered', 'wasteToCount', 'wasteUnmatched']);
  });

  it('KE_TOAN: hoàn tiền khách, thưởng đại lý đã duyệt chờ chi, VAT chờ xuất, gian hàng chờ lập phiếu, phiếu đối soát chờ chuyển, rút tiền đã duyệt chờ chi — không thấy rút tiền chờ DUYỆT (việc của ADMIN)', async () => {
    expect(await keysFor(['KE_TOAN'])).toEqual(['bankTransferToConfirm', 'customerRefunds', 'dealerClaimsToPay', 'invoicePending', 'merchantPayoutsPending', 'merchantToSettle', 'payoutsToPay', 'wasteToCount', 'wasteUnmatched']);
  });

  it('CSKH, KHO và nhân viên chưa có nhóm giữ nguyên hàng đợi như trước', async () => {
    expect(await keysFor(['CSKH'])).toEqual(['communityPending', 'communityReports', 'communityUnanswered', 'externalPoints', 'returnsPending', 'supportChatUnforwarded', 'wasteToCount', 'wasteUnmatched']);
    expect(await keysFor(['KHO'])).toEqual(['gomdonAttention', 'pancakeAttention', 'pancakeUnsynced', 'returnsToReceive', 'wasteToCount', 'wasteUnmatched']);
    expect(await keysFor([])).toEqual(['wasteToCount', 'wasteUnmatched']);
  });
});

describe('OpsInboxService — đổi rác (spec 13.2)', () => {
  const now = new Date('2026-10-17T03:00:00Z');
  const keys = (res: { items: { key: string }[] }) => res.items.map((i) => i.key);

  it('ADMIN thấy đủ khoá theo đúng thứ tự, không còn refillPending', async () => {
    const { svc } = build();

    const res = await svc.counts({ role: 'ADMIN' }, now);

    expect(keys(res)).toEqual([
      'pancakeAttention', 'pancakeUnsynced', 'gomdonAttention', 'customerRefunds', 'returnsPending', 'returnsToReceive', 'bankTransferToConfirm', 'storefrontsPending', 'productsMissingImage', 'merchantOverdue', 'merchantProducts',
      'consignmentPending', 'merchantToSettle', 'merchantPayoutsPending', 'dealerApplications', 'dealerClaims', 'dealerClaimsToPay', 'payouts', 'payoutsToPay', 'communityReports', 'communityPending',
      'communityUnanswered', 'invoicePending', 'externalPoints', 'supportChatUnforwarded', 'zaloBridgeDown', 'wasteToCount', 'wasteUnmatched', 'wasteBlockedPending', 'wastePointsPending', 'wastePerksPending',
      'wasteTransitOverdue', 'wasteGiftOverdue', 'wasteOrderMismatch',
    ]);
  });

  it('nhân viên chưa có nhóm chỉ thấy wasteToCount và wasteUnmatched; không tốn truy vấn điểm nhận hay quà', async () => {
    const { svc, pointCount, giftCount } = build();

    const res = await svc.counts({ role: 'STAFF', staffPermissions: [] }, now);

    expect(keys(res)).toEqual(['wasteToCount', 'wasteUnmatched']);
    expect(pointCount).not.toHaveBeenCalled();
    expect(giftCount).not.toHaveBeenCalled();
  });

  it('CSKH và KHO giữ khoá nhóm mình cộng hai khoá đổi rác của mọi nhân viên', async () => {
    const { svc } = build();

    expect(keys(await svc.counts({ role: 'STAFF', staffPermissions: ['CSKH'] }, now))).toEqual([
      'returnsPending', 'communityReports', 'communityPending', 'communityUnanswered', 'externalPoints', 'supportChatUnforwarded', 'wasteToCount', 'wasteUnmatched',
    ]);
    expect(keys(await svc.counts({ role: 'STAFF', staffPermissions: ['KHO'] }, now))).toEqual([
      'pancakeAttention', 'pancakeUnsynced', 'gomdonAttention', 'returnsToReceive', 'wasteToCount', 'wasteUnmatched',
    ]);
  });

  it('mỗi khoá đếm đúng một hàng đợi bằng bộ lọc dùng chung và số rơi đúng khoá', async () => {
    const { svc, wasteReqCount, unmatchedCount, pointCount, giftCount } = build();
    wasteReqCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1).mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    pointCount.mockResolvedValueOnce(5).mockResolvedValueOnce(6);
    unmatchedCount.mockResolvedValueOnce(7);
    giftCount.mockResolvedValueOnce(8);

    const res = await svc.counts({ role: 'ADMIN' }, now);

    expect(wasteReqCount).toHaveBeenCalledWith({ where: WASTE_TO_COUNT_WHERE });
    expect(wasteReqCount).toHaveBeenCalledWith({ where: wasteCustomerBlockedWhere() });
    expect(wasteReqCount).toHaveBeenCalledWith({ where: wasteTransitOverdueWhere(now, 30) });
    expect(wasteReqCount).toHaveBeenCalledWith({ where: wasteOrderMismatchWhere() });
    expect(unmatchedCount).toHaveBeenCalledWith({ where: WASTE_UNMATCHED_OPEN_WHERE });
    expect(pointCount).toHaveBeenCalledWith({ where: WASTE_POINTS_PENDING_WHERE });
    expect(pointCount).toHaveBeenCalledWith({ where: WASTE_PERKS_PENDING_WHERE });
    expect(giftCount).toHaveBeenCalledWith({ where: wasteGiftOverdueWhere(now) });
    expect(res.items).toEqual(
      expect.arrayContaining([
        { key: 'wasteToCount', count: 3 },
        { key: 'wasteUnmatched', count: 7 },
        { key: 'wasteBlockedPending', count: 1 },
        { key: 'wastePointsPending', count: 5 },
        { key: 'wastePerksPending', count: 6 },
        { key: 'wasteTransitOverdue', count: 2 },
        { key: 'wasteGiftOverdue', count: 8 },
        { key: 'wasteOrderMismatch', count: 4 },
      ]),
    );
  });

  it('khoá waste.in_transit_review_days đổi ngưỡng quá hạn đang chuyển', async () => {
    const { svc, config, wasteReqCount } = build({ config: { 'waste.in_transit_review_days': 45 } });

    await svc.counts({ role: 'ADMIN' }, now);

    expect(config.get).toHaveBeenCalledWith('waste.in_transit_review_days', 30);
    expect(wasteReqCount).toHaveBeenCalledWith({ where: wasteTransitOverdueWhere(now, 45) });
  });

  it('dựng với hai đối số (không có SystemConfigService) vẫn dùng ngưỡng 30 ngày', async () => {
    const { svc, wasteReqCount } = build({ noConfig: true });

    await svc.counts({ role: 'ADMIN' }, now);

    expect(wasteReqCount).toHaveBeenCalledWith({ where: wasteTransitOverdueWhere(now, 30) });
  });
});

describe('OpsInboxService — chat CSKH', () => {
  const now = new Date('2026-10-23T03:00:00Z');
  const count = (res: { items: { key: string; count: number }[] }, k: string) => res.items.find((i) => i.key === k)?.count;

  it('supportChatUnforwarded đếm hội thoại theo bộ lọc dùng chung; CSKH thấy, KHO không', async () => {
    const { svc, supportConvCount } = build({ supportUnforwarded: 4 });
    expect(count(await svc.counts({ role: 'STAFF', staffPermissions: ['CSKH'] }, now), 'supportChatUnforwarded')).toBe(4);
    expect((await svc.counts({ role: 'STAFF', staffPermissions: ['KHO'] }, now)).items.map((i) => i.key)).not.toContain('supportChatUnforwarded');
    expect(supportConvCount).toHaveBeenCalledWith({
      where: {
        blockedAt: null,
        OR: [
          { forwards: { some: { status: { in: ['FAILED', 'UNKNOWN'] } } } },
          { forwards: { some: { status: 'PENDING', zaloMsgId: null, updatedAt: { lt: new Date('2026-10-23T02:50:00Z') } } } },
          { messages: { some: { sender: 'CUSTOMER', forwardId: null, createdAt: { lt: new Date('2026-10-23T02:50:00Z') } } } },
        ],
      },
    });
  });

  it('zaloBridgeDown: 1 khi không CONNECTED quá 10 phút, 0 khi mới mất hoặc đang nối; nhân viên không thấy', async () => {
    const since = (min: number) => new Date(now.getTime() - min * 60_000);
    expect(count(await build({ bridge: { state: 'NEED_QR', since: since(11) } }).svc.counts({ role: 'ADMIN' }, now), 'zaloBridgeDown')).toBe(1);
    expect(count(await build({ bridge: { state: 'NEED_QR', since: since(9) } }).svc.counts({ role: 'ADMIN' }, now), 'zaloBridgeDown')).toBe(0);
    expect(count(await build({ bridge: { state: 'CONNECTED', since: since(600) } }).svc.counts({ role: 'ADMIN' }, now), 'zaloBridgeDown')).toBe(0);
    expect(count(await build().svc.counts({ role: 'ADMIN' }, now), 'zaloBridgeDown')).toBe(0);
    expect((await build().svc.counts({ role: 'STAFF', staffPermissions: ['CSKH'] }, now)).items.map((i) => i.key)).not.toContain('zaloBridgeDown');
  });

  it('zaloBridgeDown về 0 khi chưa cấu hình cầu nối hoặc chat đang tắt; supportChatUnforwarded không đổi', async () => {
    const bridge = { state: 'ERROR', since: new Date(now.getTime() - 60 * 60_000) };
    const noUrl = build({ bridge, bridgeUrl: '', supportUnforwarded: 2 });
    const res = await noUrl.svc.counts({ role: 'ADMIN' }, now);
    expect(count(res, 'zaloBridgeDown')).toBe(0);
    expect(count(res, 'supportChatUnforwarded')).toBe(2);
    const off = build({ bridge, config: { 'chat.enabled': false }, supportUnforwarded: 2 });
    const res2 = await off.svc.counts({ role: 'ADMIN' }, now);
    expect(count(res2, 'zaloBridgeDown')).toBe(0);
    expect(count(res2, 'supportChatUnforwarded')).toBe(2);
    expect(count(await build({ bridge }).svc.counts({ role: 'ADMIN' }, now), 'zaloBridgeDown')).toBe(1);
  });
});

describe('OpsInboxService: hàng đợi đã có ở tab nhưng từng thiếu trong hộp việc (R-13, R-73, R-75)', () => {
  const now = new Date('2026-10-28T03:00:00Z');
  const find = (res: { items: { key: string; count: number; hoursLeft?: number }[] }, key: string) => res.items.find((i) => i.key === key);

  const withMocks = (over: { bank?: number; oldest?: Date | null; stores?: number; reports?: number; noImage?: number }) => {
    const base = build({ config: { 'orders.pending_payment_ttl_hours': 24 } });
    const prisma = (base.svc as unknown as { prisma: Record<string, any> }).prisma;
    prisma.order.count.mockImplementation((a?: { where?: { paymentMethod?: string } }) => Promise.resolve(a?.where?.paymentMethod === 'BANK_TRANSFER' ? (over.bank ?? 0) : 0));
    prisma.order.findFirst.mockResolvedValue(over.oldest === undefined || over.oldest === null ? null : { createdAt: over.oldest });
    prisma.storefront.count.mockResolvedValue(over.stores ?? 0);
    prisma.communityReport.count.mockResolvedValue(over.reports ?? 0);
    prisma.product.count.mockImplementation((a?: { where?: { images?: unknown } }) => Promise.resolve(a?.where?.images ? (over.noImage ?? 0) : 0));
    return { ...base, prisma };
  };

  it('bankTransferToConfirm: đơn lẻ chuyển khoản chưa thanh toán đang chờ; thẻ ghi số giờ còn lại trước khi tự huỷ; KE_TOAN và ADMIN thấy', async () => {
    const { svc, prisma } = withMocks({ bank: 2, oldest: new Date('2026-10-27T10:00:00Z') });

    const res = await svc.counts({ role: 'ADMIN' }, now);

    expect(find(res, 'bankTransferToConfirm')).toEqual({ key: 'bankTransferToConfirm', count: 2, hoursLeft: 7 });
    expect(prisma.order.count).toHaveBeenCalledWith({ where: { type: 'RETAIL', status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', paymentMethod: 'BANK_TRANSFER' } });
    const kt = await svc.counts({ role: 'STAFF', staffPermissions: ['KE_TOAN'] }, now);
    expect(find(kt, 'bankTransferToConfirm')?.count).toBe(2);
    const kho = await svc.counts({ role: 'STAFF', staffPermissions: ['KHO'] }, now);
    expect(find(kho, 'bankTransferToConfirm')).toBeUndefined();
  });

  it('bankTransferToConfirm: đơn đã quá hạn chờ thì hoursLeft = 0, không âm; không có đơn thì không có hoursLeft', async () => {
    const late = await withMocks({ bank: 1, oldest: new Date('2026-10-20T00:00:00Z') }).svc.counts({ role: 'ADMIN' }, now);
    expect(find(late, 'bankTransferToConfirm')?.hoursLeft).toBe(0);
    const none = await withMocks({ bank: 0 }).svc.counts({ role: 'ADMIN' }, now);
    expect(find(none, 'bankTransferToConfirm')).toEqual({ key: 'bankTransferToConfirm', count: 0 });
  });

  it('storefrontsPending, productsMissingImage: chỉ ADMIN; communityReports: người kiểm duyệt cộng đồng', async () => {
    const { svc, prisma } = withMocks({ stores: 1, noImage: 4, reports: 3 });

    const admin = await svc.counts({ role: 'ADMIN' }, now);
    expect(find(admin, 'storefrontsPending')?.count).toBe(1);
    expect(find(admin, 'productsMissingImage')?.count).toBe(4);
    expect(find(admin, 'communityReports')?.count).toBe(3);
    expect(prisma.storefront.count).toHaveBeenCalledWith({ where: { isPublished: true, takenDownAt: null, type: 'CTV', isPartner: false, approvedAt: null } });
    expect(prisma.communityReport.count).toHaveBeenCalledWith({ where: { status: 'OPEN' } });
    expect(prisma.product.count).toHaveBeenCalledWith({ where: { isActive: true, images: { isEmpty: true } } });
    const cskh = await svc.counts({ role: 'STAFF', staffPermissions: ['CSKH'] }, now);
    expect(find(cskh, 'communityReports')?.count).toBe(3);
    expect(find(cskh, 'storefrontsPending')).toBeUndefined();
    expect(find(cskh, 'productsMissingImage')).toBeUndefined();
  });
});
