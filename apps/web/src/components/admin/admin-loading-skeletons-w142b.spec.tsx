// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ listCampaigns: vi.fn(), getCampaign: vi.fn(), listBundles: vi.fn(), getBundle: vi.fn() }));
vi.mock('@/lib/admin-campaigns-client', () => ({
  listAdminCampaigns: mocks.listCampaigns,
  getAdminCampaign: mocks.getCampaign,
  createAdminCampaign: vi.fn(),
  updateAdminCampaign: vi.fn(),
  deleteAdminCampaign: vi.fn(),
  checkAdminCampaign: vi.fn(),
}));
vi.mock('@/lib/admin-bundles-client', () => ({
  listAdminBundles: mocks.listBundles,
  getAdminBundle: mocks.getBundle,
  createAdminBundle: vi.fn(),
  updateAdminBundle: vi.fn(),
  deleteAdminBundle: vi.fn(),
}));

import { BundlesTab } from './bundles-tab';
import { CampaignsTab } from './campaigns-tab';
import { EngagementTab } from './engagement-tab';
import { EventsPanel } from './community-events-panel';
import { MerchantFulfilmentTab } from './merchant-fulfilment-tab';
import { PayoutAdminTab } from './payout-admin-tab';
import { PayrollAdminTab } from './payroll-admin-tab';
import { ReportsRevenueSection } from './reports-revenue-section';
import { ReviewsTab } from './reviews-tab';
import { WasteRequestDetail } from './waste-request-detail';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const skeleton = (c: HTMLElement, label: string) => c.querySelector(`[role="status"][aria-busy="true"][aria-label="${label}"]`);

// W142B: nốt các tab còn dòng "Đang tải…" trơ (nối tiếp admin-loading-skeletons.spec.tsx).
const TABS: [string, () => ReactElement, string][] = [
  ['Bảng lương', () => <PayrollAdminTab />, 'Đang tải bảng lương'],
  ['Nhiệm vụ', () => <EngagementTab />, 'Đang tải danh sách nhiệm vụ'],
  ['Đơn đối tác', () => <MerchantFulfilmentTab isAdmin />, 'Đang tải tổng quan đơn đối tác'],
  ['Báo cáo doanh thu', () => <ReportsRevenueSection range={{ from: '2026-11-01', to: '2026-11-07' }} />, 'Đang tải báo cáo doanh thu'],
  ['Lệnh rút', () => <PayoutAdminTab />, 'Đang tải danh sách lệnh rút'],
  ['Đánh giá', () => <ReviewsTab />, 'Đang tải đánh giá'],
  ['Sự kiện cộng đồng', () => <EventsPanel />, 'Đang tải danh sách sự kiện'],
  ['Chi tiết yêu cầu đổi rác', () => <WasteRequestDetail id="w1" isAdmin onClose={() => {}} />, 'Đang tải yêu cầu'],
];

describe('W142B: tab quản trị đang tải lần đầu hiện khung xương', () => {
  it.each(TABS)('%s: khung xương có tên, không còn chữ "Đang tải…" trơ', (_name, ui, label) => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const r = render(ui());
    mounted.push(r);
    const sk = skeleton(r.container, label);
    expect(sk, `không thấy khung xương "${label}"`).not.toBeNull();
    expect(sk!.hasAttribute('data-skeleton')).toBe(true);
    expect(r.container.textContent).not.toMatch(/Đang tải/);
  });

  it('báo cáo doanh thu dùng khung xương dạng bảng (bảng ngày × kênh)', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const r = render(<ReportsRevenueSection range={{ from: '2026-11-01', to: '2026-11-07' }} />);
    mounted.push(r);
    expect(skeleton(r.container, 'Đang tải báo cáo doanh thu')!.getAttribute('data-skeleton')).toBe('table');
  });

  it('Chiến dịch: bấm Sửa, chi tiết chưa về thì hiện khung xương thay vì chữ trơ', async () => {
    mocks.listCampaigns.mockResolvedValue([
      {
        id: 'a', slug: 'cd-a', title: 'Chiến dịch a', subtitle: null, placement: 'HOME_TOP', image: null, linkType: 'CAMPAIGN_PAGE', linkValue: null,
        audience: 'ALL', startAt: '2026-10-31T17:00:00.000Z', endAt: '2026-11-10T16:59:00.000Z', sortOrder: 0, isActive: true,
        productCount: 0, couponCount: 0, status: 'live', health: { blockers: 0, warnings: 0 },
      },
    ]);
    mocks.getCampaign.mockReturnValue(new Promise(() => {}));
    const r = render(<CampaignsTab />);
    mounted.push(r);
    await flush(6);
    click(r.container.querySelector('button[aria-label="Sửa chiến dịch Chiến dịch a"]'));
    await flush(2);
    expect(skeleton(r.container, 'Đang tải chiến dịch')).not.toBeNull();
    expect(r.container.textContent).not.toMatch(/Đang tải/);
  });

  it('Combo và mua kèm: bấm Sửa, chi tiết chưa về thì hiện khung xương thay vì chữ trơ', async () => {
    mocks.listBundles.mockResolvedValue([
      {
        id: 'a', kind: 'BUNDLE_PCT', title: 'Bộ a', pct: 10, anchorProductId: null, anchorProductName: null,
        startAt: '2026-10-31T17:00:00.000Z', endAt: '2026-11-10T16:59:00.000Z', isActive: true, sortOrder: 0, status: 'live', createdById: 'u1', createdByStaff: true,
        items: [{ productId: 'p1', productName: 'Xà phòng', productSlug: 'xa-phong', variationId: null, variationName: null, addonPrice: null, refPrice: null, maxQty: 1, price: 50_000 }],
      },
    ]);
    mocks.getBundle.mockReturnValue(new Promise(() => {}));
    const r = render(<BundlesTab isAdmin />);
    mounted.push(r);
    await flush(6);
    click(byText(r.container, 'button', 'Sửa'));
    await flush(2);
    expect(skeleton(r.container, 'Đang tải bộ sản phẩm')).not.toBeNull();
    expect(r.container.textContent).not.toMatch(/Đang tải/);
  });
});
