// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { INBOX_LABELS, InboxBadge, OpsInboxTab } from './ops-inbox-tab';
import { click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const stubInbox = (items: { key: string; count: number }[]) => {
  const api = mockFetch({ '/admin/ops/inbox': { body: { generatedAt: '2026-10-14T03:00:00.000Z', items } } });
  vi.stubGlobal('fetch', vi.fn(api.fn));
};

describe('OpsInboxTab — việc với đối tác (R4-ADMIN-7)', () => {
  it('có thẻ riêng cho liên kết ký gửi chờ xác nhận, khoản chờ lập phiếu và phiếu chờ chuyển/thu; bấm thẻ mở đúng khoá', async () => {
    stubInbox([
      { key: 'consignmentPending', count: 1 },
      { key: 'merchantToSettle', count: 2 },
      { key: 'merchantPayoutsPending', count: 3 },
      { key: 'merchantOverdue', count: 0 },
    ]);
    const onOpen = vi.fn();
    const r = render(<OpsInboxTab onOpen={onOpen} />);
    mounted.push(r);
    await flush();
    const root = r.container;

    const card = (k: string) => root.querySelector<HTMLButtonElement>(`[data-inbox="${k}"]`)!;
    expect(card('consignmentPending').textContent).toContain('Liên kết ký gửi chờ xác nhận');
    expect(card('consignmentPending').textContent).toContain('1');
    expect(card('merchantToSettle').textContent).toContain('Gian hàng có khoản chờ lập phiếu');
    expect(card('merchantToSettle').textContent).toContain('2');
    expect(card('merchantPayoutsPending').textContent).toContain('Phiếu đối soát chờ chuyển / thu');
    expect(card('merchantPayoutsPending').textContent).toContain('3');

    click(card('consignmentPending'));
    click(card('merchantToSettle'));
    click(card('merchantPayoutsPending'));
    expect(onOpen.mock.calls.map((c) => c[0])).toEqual(['consignmentPending', 'merchantToSettle', 'merchantPayoutsPending']);
  });

  it('API trả khoá web chưa biết (triển khai lệch phiên bản) thì bỏ qua, các thẻ còn lại vẫn hiện', async () => {
    stubInbox([
      { key: 'khoaMoiChuaCoNhan', count: 4 },
      { key: 'merchantToSettle', count: 1 },
    ]);
    const r = render(<OpsInboxTab onOpen={vi.fn()} />);
    mounted.push(r);
    await flush();
    expect(r.container.querySelector('[data-inbox="merchantToSettle"]')).not.toBeNull();
    expect(r.container.querySelector('[data-inbox="khoaMoiChuaCoNhan"]')).toBeNull();
    expect(r.container.textContent).not.toContain('Không tải được');
  });

  it('hộp việc có tám khoá đổi rác, không còn đổi vỏ chai, không có khoá cảnh báo (13.2, 5.5)', async () => {
    expect(Object.keys(INBOX_LABELS)).toEqual(
      expect.arrayContaining(['wasteToCount', 'wasteUnmatched', 'wasteBlockedPending', 'wastePointsPending', 'wastePerksPending', 'wasteTransitOverdue', 'wasteGiftOverdue', 'wasteOrderMismatch']),
    );
    expect(Object.keys(INBOX_LABELS)).not.toContain('refillPending');
    expect(Object.keys(INBOX_LABELS).filter((k) => /alert/i.test(k))).toEqual([]);
    stubInbox([
      { key: 'wasteToCount', count: 3 },
      { key: 'wasteGiftOverdue', count: 1 },
      { key: 'refillPending', count: 5 },
    ]);
    const onOpen = vi.fn();
    const r = render(<OpsInboxTab onOpen={onOpen} />);
    mounted.push(r);
    await flush();
    const root = r.container;
    const toCount = root.querySelector<HTMLButtonElement>('[data-inbox="wasteToCount"]')!;
    expect(toCount.textContent).toContain('Kiện đổi rác chờ đếm');
    expect(toCount.textContent).toContain('3');
    expect(root.querySelector('[data-inbox="refillPending"]')).toBeNull();
    click(root.querySelector<HTMLButtonElement>('[data-inbox="wasteGiftOverdue"]')!);
    expect(onOpen).toHaveBeenCalledWith('wasteGiftOverdue');
  });

  it('kế toán có thẻ thưởng đại lý đã duyệt chờ "Đã chi"; bấm thẻ mở đúng khoá', async () => {
    stubInbox([{ key: 'dealerClaimsToPay', count: 2 }]);
    const onOpen = vi.fn();
    const r = render(<OpsInboxTab onOpen={onOpen} />);
    mounted.push(r);
    await flush();

    const card = r.container.querySelector<HTMLButtonElement>('[data-inbox="dealerClaimsToPay"]');
    expect(card?.textContent).toContain('Thưởng đại lý chờ chi');
    expect(card?.textContent).toContain('2');
    click(card!);
    expect(onOpen).toHaveBeenCalledWith('dealerClaimsToPay');
  });

  it('kế toán có thẻ rút tiền đã duyệt chờ "Đã chi"; bấm thẻ mở đúng khoá', async () => {
    stubInbox([{ key: 'payoutsToPay', count: 3 }]);
    const onOpen = vi.fn();
    const r = render(<OpsInboxTab onOpen={onOpen} />);
    mounted.push(r);
    await flush();

    const card = r.container.querySelector<HTMLButtonElement>('[data-inbox="payoutsToPay"]')!;
    expect(card.textContent).toContain('Lệnh rút ngân hàng cũ chờ chi');
    expect(card.textContent).toContain('3');
    click(card);
    expect(onOpen).toHaveBeenCalledWith('payoutsToPay');
  });

  it('có hai thẻ Chat CSKH và cầu nối Zalo; bấm thẻ mở đúng khoá', async () => {
    stubInbox([
      { key: 'supportChatUnforwarded', count: 2 },
      { key: 'zaloBridgeDown', count: 1 },
    ]);
    const onOpen = vi.fn();
    const r = render(<OpsInboxTab onOpen={onOpen} />);
    mounted.push(r);
    await flush();
    const card = (k: string) => r.container.querySelector<HTMLButtonElement>(`[data-inbox="${k}"]`)!;
    expect(card('supportChatUnforwarded').textContent).toContain('Chat CSKH: tin chưa chuyển được vào Zalo');
    expect(card('supportChatUnforwarded').textContent).toContain('2');
    expect(card('zaloBridgeDown').textContent).toContain('Cầu nối Zalo mất kết nối');
    click(card('supportChatUnforwarded'));
    click(card('zaloBridgeDown'));
    expect(onOpen.mock.calls.map((c) => c[0])).toEqual(['supportChatUnforwarded', 'zaloBridgeDown']);
  });

  it('mọi khoá của hộp việc có nhãn tiếng Việt có dấu và gợi ý', () => {
    for (const [key, l] of Object.entries(INBOX_LABELS)) {
      expect(l.title.length, key).toBeGreaterThan(5);
      expect(l.hint.length, key).toBeGreaterThan(5);
    }
  });
});

describe('OpsInboxTab — trang "Hôm nay" (R-13, R-74, R-75, R-144)', () => {
  const stub = (items: { key: string; count: number; hoursLeft?: number }[], extra: Record<string, { status?: number; body: unknown }> = {}) => {
    const api = mockFetch({
      '/admin/ops/inbox': { body: { generatedAt: '2026-10-28T03:00:00.000Z', items } },
      ...extra,
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    return api;
  };

  it('có thẻ cho đơn chuyển khoản chờ tiền (kèm số giờ còn lại), gian hàng chờ duyệt, báo cáo cộng đồng, sản phẩm thiếu ảnh; bấm mở đúng khoá', async () => {
    stub([
      { key: 'bankTransferToConfirm', count: 1, hoursLeft: 7 },
      { key: 'storefrontsPending', count: 2 },
      { key: 'communityReports', count: 3 },
      { key: 'productsMissingImage', count: 4 },
    ]);
    const onOpen = vi.fn();
    const r = render(<OpsInboxTab onOpen={onOpen} />);
    mounted.push(r);
    await flush();
    const card = (k: string) => r.container.querySelector<HTMLButtonElement>(`[data-inbox="${k}"]`)!;
    expect(r.container.textContent).not.toContain('Không còn việc nào đang chờ');
    expect(card('bankTransferToConfirm').textContent).toContain('Đơn chuyển khoản chờ xác nhận tiền');
    expect(card('bankTransferToConfirm').textContent).toContain('còn 7 giờ trước khi tự huỷ');
    expect(card('storefrontsPending').textContent).toContain('Gian hàng chờ duyệt');
    expect(card('communityReports').textContent).toContain('Báo cáo vi phạm cộng đồng');
    expect(card('productsMissingImage').textContent).toContain('Sản phẩm đang bán thiếu ảnh');
    for (const k of ['bankTransferToConfirm', 'storefrontsPending', 'communityReports', 'productsMissingImage']) click(card(k));
    expect(onOpen.mock.calls.map((c) => c[0])).toEqual(['bankTransferToConfirm', 'storefrontsPending', 'communityReports', 'productsMissingImage']);
  });

  it('đơn chuyển khoản đã quá hạn ghi rõ sắp tự huỷ', async () => {
    stub([{ key: 'bankTransferToConfirm', count: 1, hoursLeft: 0 }]);
    const r = render(<OpsInboxTab onOpen={vi.fn()} />);
    mounted.push(r);
    await flush();
    expect(r.container.querySelector('[data-inbox="bankTransferToConfirm"]')!.textContent).toContain('đã quá hạn');
  });

  it('hàng đợi rỗng gom một dòng "N hàng đợi đang trống", bấm mới mở danh sách chip', async () => {
    stub([
      { key: 'merchantOverdue', count: 0 },
      { key: 'dealerClaims', count: 0 },
      { key: 'payouts', count: 0 },
    ]);
    const r = render(<OpsInboxTab onOpen={vi.fn()} />);
    mounted.push(r);
    await flush();
    const toggle = [...r.container.querySelectorAll('button')].find((b) => b.textContent?.includes('hàng đợi đang trống'))!;
    expect(toggle.textContent).toContain('2 hàng đợi đang trống');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(r.container.querySelectorAll('li').length).toBe(0);
    click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(r.container.querySelectorAll('li').length).toBe(2);
    expect(r.container.textContent).not.toContain('· 0');
  });

  it('ADMIN thấy bốn số hôm nay (doanh thu, đơn, khách mới, khách mua lại 30 ngày); nhân viên không gọi API số bán', async () => {
    const api = stub([{ key: 'merchantOverdue', count: 1 }], {
      '/admin/dashboard/today': {
        body: { orders: { today: 5, yesterday: 3, week: 20 }, revenue: { today: 1500000, yesterday: 2000000, week: 9000000 }, newUsers: { today: 2, yesterday: 2, week: 11 } },
      },
      '/admin/analytics/retention': {
        body: [{ date: '2026-10-27', newBuyers: 1, activeBuyers: 1, ordersCount: 1, ordersPerBuyerMtd: 1, dauProxyRefreshToken: 1, dauEventBased: null, ns1CohortSize: 10, ns1RepeatCount: 3 }],
      },
    });
    const admin = render(<OpsInboxTab onOpen={vi.fn()} isAdmin />);
    mounted.push(admin);
    await flush();
    const stat = (label: string) => admin.container.querySelector(`[role="group"][aria-label="${label}"]`)!.textContent ?? '';
    expect(admin.container.querySelector('h2')!.textContent).toBe('Hôm nay');
    expect(stat('Doanh thu hôm nay')).toContain('1.500.000');
    expect(stat('Doanh thu hôm nay')).toContain('so với hôm qua');
    expect(stat('Đơn hôm nay')).toContain('5');
    expect(stat('Đơn hôm nay')).toContain('+2 so với hôm qua');
    expect(stat('Khách mới hôm nay')).toContain('7 ngày: 11');
    expect(stat('Khách mua lại (30 ngày)')).toContain('30%');
    expect(stat('Khách mua lại (30 ngày)')).toContain('3/10');
    admin.unmount();
    mounted = [];
    api.calls.length = 0;
    const staff = render(<OpsInboxTab onOpen={vi.fn()} />);
    mounted.push(staff);
    await flush();
    expect(api.calls.some((c) => c.url.includes('/admin/dashboard/today'))).toBe(false);
    expect(staff.container.querySelector('[role="group"][aria-label="Doanh thu hôm nay"]')).toBeNull();
  });

  it('một số lỗi không kéo sập trang: số bán lỗi thì hiện thử lại, các thẻ việc vẫn hiện', async () => {
    stub([{ key: 'merchantOverdue', count: 1 }], { '/admin/dashboard/today': { status: 500, body: { message: 'lỗi' } }, '/admin/analytics/retention': { body: [] } });
    const r = render(<OpsInboxTab onOpen={vi.fn()} isAdmin />);
    mounted.push(r);
    await flush();
    expect(r.container.textContent).toContain('Không tải được số bán hàng hôm nay');
    expect(r.container.querySelector('[data-inbox="merchantOverdue"]')).not.toBeNull();
  });

  it('huy hiệu menu cộng số việc theo mục đích; mục "inbox" hiện tổng; không có việc thì không hiện', async () => {
    stub([
      { key: 'communityPending', count: 2 },
      { key: 'communityReports', count: 3 },
      { key: 'bankTransferToConfirm', count: 1 },
      { key: 'payouts', count: 9 },
      { key: 'dealerClaims', count: 0 },
    ]);
    const r = render(
      <>
        <InboxBadge tab="community" />
        <InboxBadge tab="orders" />
        <InboxBadge tab="inbox" />
        <InboxBadge tab="dealerClaims" />
      </>,
    );
    mounted.push(r);
    await flush();
    const badges = [...r.container.querySelectorAll('[data-inbox-badge]')].map((b) => [b.getAttribute('data-inbox-badge'), b.textContent?.replace(/[^0-9]/g, '')]);
    expect(badges).toEqual([['community', '5'], ['orders', '1'], ['inbox', '6']]);
  });
});
