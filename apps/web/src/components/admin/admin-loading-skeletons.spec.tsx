// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { render, type Rendered } from '@/test-utils/dom';
import { CashbackTab } from './cashback-tab';
import { CouponList } from './coupon-list';
import { DealerClaimsTab } from './dealer-claims-tab';
import { ExternalOrdersTab } from './external-orders-tab';
import { MerchantProductsTab } from './merchant-products-tab';
import { NotificationTemplatesTab } from './notification-templates-tab';
import { PosCreditsTab } from './pos-credits-tab';
import { ShiftApprovalTab } from './shift-approval-tab';
import { StorefrontsTab } from './storefronts-tab';
import { SubscriptionsTab } from './subscriptions-tab';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

// D10: "Đang tải…" trơ trong ~31 tab; tab chính phải dùng khung xương có tên cho trình đọc màn hình và giữ chỗ để trang không giật khi dữ liệu về.
const TABS: [string, () => ReactElement, string][] = [
  ['Hoàn tiền', () => <CashbackTab />, 'Đang tải cấu hình hoàn tiền'],
  ['Mã giảm giá', () => <CouponList />, 'Đang tải danh sách mã'],
  ['Yêu cầu đại lý', () => <DealerClaimsTab />, 'Đang tải yêu cầu của đại lý'],
  ['Đơn nguồn ngoài', () => <ExternalOrdersTab isAdmin />, 'Đang tải đơn từ nguồn ngoài'],
  ['Sản phẩm gian hàng', () => <MerchantProductsTab />, 'Đang tải danh sách sản phẩm gian hàng'],
  ['Mẫu thông báo', () => <NotificationTemplatesTab />, 'Đang tải mẫu thông báo'],
  ['Điểm tại quầy', () => <PosCreditsTab />, 'Đang tải điểm cộng tại quầy'],
  ['Ca làm', () => <ShiftApprovalTab />, 'Đang tải danh sách ca làm'],
  ['Gian hàng', () => <StorefrontsTab />, 'Đang tải danh sách gian hàng'],
  ['Gói định kỳ', () => <SubscriptionsTab />, 'Đang tải gói định kỳ'],
];

describe('tab quản trị đang tải lần đầu hiện khung xương', () => {
  it.each(TABS)('%s: khung xương có tên, không còn chữ "Đang tải…" trơ', (_name, ui, label) => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const r = render(ui());
    mounted.push(r);
    const sk = r.container.querySelector(`[role="status"][aria-busy="true"][aria-label="${label}"]`);
    expect(sk, `không thấy khung xương "${label}"`).not.toBeNull();
    expect(sk!.hasAttribute('data-skeleton')).toBe(true);
    expect(r.container.textContent).not.toMatch(/Đang tải/);
  });
});
