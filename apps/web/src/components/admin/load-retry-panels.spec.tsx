// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DealerTiersSection } from './dealer-tiers-section';
import { ExternalClaimsTab } from './external-claims-tab';
import { ExternalOrdersTab } from './external-orders-tab';
import { GomdonConfigCard } from './gomdon-config-card';
import { UserDetailDrawer } from './user-detail-drawer';
import { WasteRequestDetail } from './waste-request-detail';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { wasteRequestDetail } from '@/test-utils/fixtures/waste-admin';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Mọi đường trả 200 theo bảng `ok` (khoá dài nhất khớp trước) trừ `failing`: trả 500 tới khi `heal()`. Panel con và ngăn
 * kéo (D7-19) chỉ hiện chữ đỏ thì nhân viên phải đóng mở lại hoặc F5 mới tải lại được.
 */
function stub(ok: Record<string, unknown>, failing: string, fallback: unknown = {}) {
  let broken = true;
  const hits: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes(failing)) {
        hits.push(url);
        if (broken) return json({ message: 'Máy chủ đang bận, vui lòng thử lại sau.' }, 500);
      }
      const key = Object.keys(ok)
        .sort((a, b) => b.length - a.length)
        .find((k) => url.includes(k));
      return json(key ? ok[key] : fallback);
    }),
  );
  return { heal: () => (broken = false), hits: () => hits.length };
}

const mount = (ui: ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
const retry = (root: ParentNode) => byText(root, 'button', 'Thử lại');

async function expectRetryHeals(root: ParentNode, api: ReturnType<typeof stub>, then: () => void) {
  const button = retry(root);
  expect(button, 'không thấy nút Thử lại').not.toBeNull();
  const before = api.hits();
  api.heal();
  click(button);
  await flush();
  expect(api.hits()).toBeGreaterThan(before);
  expect(retry(root)).toBeNull();
  then();
}

describe('panel con và ngăn kéo — lỗi tải có nút "Thử lại" (D7-19)', () => {
  it('chi tiết yêu cầu đổi rác', async () => {
    const api = stub({ '/admin/waste/requests/r1': wasteRequestDetail() }, '/admin/waste/requests/r1');
    const { container } = mount(<WasteRequestDetail id="r1" isAdmin onClose={() => undefined} />);
    await flush();
    await expectRetryHeals(container, api, () => expect(container.textContent).toContain('TR-7K3M9Q'));
  });

  it('ô "Gắn kiện không rõ chủ" khi mở lại yêu cầu đổi rác', async () => {
    const api = stub(
      { '/admin/waste/requests/r1': wasteRequestDetail({ status: 'EXPIRED', closeReason: 'HOLD_EXPIRED' }), '/admin/waste/unmatched': [] },
      '/admin/waste/unmatched',
    );
    const { container } = mount(<WasteRequestDetail id="r1" isAdmin onClose={() => undefined} />);
    await flush();
    click(byText(container, 'button', 'Mở lại yêu cầu'));
    await flush();
    const panel = container.querySelector('[data-reopen-panel]')!;
    await expectRetryHeals(panel, api, () => expect(panel.querySelector('select[name="reopenUnmatchedId"]')).not.toBeNull());
  });

  it('lịch sử thay đổi bậc đại lý', async () => {
    const tier = { id: 'DEALER_2', name: 'Đại lý Cấp 2', minOrderVolume: 30_000_000, discountPct: 30, creditLimit: 5_000_000, paymentTerms: 'NET 15', dealerCount: 2 };
    const api = stub({ '/admin/dealer-tiers/manage': { tiers: [tier], maxDiscountPct: 45, dealersWithoutTier: 0 }, '/admin/dealer-tiers/history': [] }, '/admin/dealer-tiers/history');
    const { container } = mount(<DealerTiersSection />);
    await flush();
    click(byText(container, 'button', 'Lịch sử thay đổi bậc'));
    await flush();
    await expectRetryHeals(container, api, () => expect(container.textContent).toContain('Chưa có thay đổi nào.'));
  });

  it('chi tiết yêu cầu tích điểm đơn sàn', async () => {
    const claim = {
      id: 'c1', externalOrderId: 'e1', pancakeOrderId: '910001', channel: 'Shopee', source: 'MARKETPLACE', maskedCode: 'SPX***789',
      userId: 'u1', userName: 'Lan', userPhoneMasked: '091****678', orderPhoneMasked: '091****678', goodsValue: 320000, points: 3200,
      state: 'REVIEW', orderStatus: 'DELIVERED', reviewReason: 'Vượt ngưỡng', voidReason: null, decidedById: null,
      deliveredAt: '2026-10-13T08:30:00.000Z', creditedAt: null, createdAt: '2026-10-13T08:31:00.000Z',
    };
    const list = { data: [claim], meta: { page: 1, limit: 20, total: 1 } };
    const api = stub(
      { '/admin/external-claims?': list, '/admin/external-claims/attempts?': { data: [], meta: { page: 1, limit: 20, total: 0 } }, '/admin/external-claims/c1': { ...claim, events: [] } },
      '/admin/external-claims/c1',
    );
    const { container } = mount(<ExternalClaimsTab isAdmin canAct meId="ad1" />);
    await flush();
    click(byText(container, 'button', 'Chi tiết'));
    await flush();
    await expectRetryHeals(container.querySelector('[data-claim-detail]')!, api, () => expect(container.querySelector('[data-claim-detail]')!.textContent).toContain('Mã yêu cầu'));
  });

  it('payload Pancake của đơn ngoài app', async () => {
    const order = {
      id: 'x1', pancakeOrderId: '910001', source: 'MARKETPLACE', channel: 'shopee', sourceKey: '-3|shopee_gian_hang|-3', trackingCode: 'SPXVN0123456789',
      trackingCodes: ['SPXVN0123456789'], marketplaceOrderSn: '2410101ABCDEF', phone: '091****678', goodsValue: 320000, pancakeStatus: 3, status: 'DELIVERED',
      pancakeUpdatedAt: '2026-10-13T08:30:00.000Z', deliveredAt: '2026-10-13T08:30:00.000Z', firstSeenAt: '2026-10-13T08:31:00.000Z',
    };
    const api = stub(
      {
        '/admin/external-orders/sources': { sources: [], truncated: false },
        '/admin/external-orders?': { data: [order], meta: { page: 1, limit: 20, total: 1 } },
        '/admin/external-orders/x1': { ...order, lastPayload: { id: 910001 } },
      },
      '/admin/external-orders/x1',
    );
    const { container } = mount(<ExternalOrdersTab isAdmin />);
    await flush();
    click(byText(container, 'button', 'Xem payload Pancake'));
    await flush();
    await expectRetryHeals(container, api, () => expect(container.querySelector('[data-raw-payload]')).not.toBeNull());
  });

  it('trạng thái khoá đổi rác trong ngăn kéo người dùng', async () => {
    const detail = {
      user: { id: 'u1', fullName: 'Nguyễn Văn An', phone: '0944444444', email: null, role: 'CUSTOMER', staffPermissions: [], referralCode: null, pointsBalance: 55, pointsConvertedBalance: 0, walletBalance: 0, isBlocked: false, blockedAt: null, blockedReason: null, createdAt: '2026-09-01T03:00:00.000Z', tier: null },
      orders: { items: [], total: 0 },
      wallet: [],
      points: [],
      roleHistory: [],
      blockHistory: [],
      grants: [],
    };
    const flags = { userId: 'u1', shipLockedAt: null, shipUnlockedAt: null, blockedAt: null, reason: null, setByUserId: null, updatedAt: null };
    const api = stub({ '/admin/waste/users/u1/flags': flags }, '/admin/waste/users/u1/flags', detail);
    mount(<UserDetailDrawer userId="u1" isAdmin onClose={() => undefined} />);
    await flush();
    await expectRetryHeals(document.body, api, () => expect(document.body.textContent).not.toContain('Không tải được trạng thái khoá đổi rác'));
  });

  it('tình trạng tích hợp Gomdon', async () => {
    const status = { baseUrlSet: true, credentialsSet: true, configured: true, webhookSecretSet: true, recyclingToggle: true, recyclingEnabled: true, pickupVisible: true };
    const api = stub({ '/admin/gomdon/status': status }, '/admin/gomdon/status');
    const { container } = mount(<GomdonConfigCard rows={[]} />);
    await flush();
    await expectRetryHeals(container, api, () => expect(container.textContent).toContain('Base URL'));
  });
});
