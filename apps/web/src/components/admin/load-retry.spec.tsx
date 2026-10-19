// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttendanceTab } from './attendance-tab';
import { CashbackTab } from './cashback-tab';
import { CouponList } from './coupon-list';
import { DealerPriceHistoryTab } from './dealer-price-history-tab';
import { EngagementTab } from './engagement-tab';
import { ExternalClaimsTab } from './external-claims-tab';
import { ExternalOrdersTab } from './external-orders-tab';
import { MerchantFulfilmentTab } from './merchant-fulfilment-tab';
import { MerchantProductsTab } from './merchant-products-tab';
import { NotificationTemplatesTab } from './notification-templates-tab';
import { OpsHealthTab } from './ops-health-tab';
import { OpsInboxTab } from './ops-inbox-tab';
import { PosCreditsTab } from './pos-credits-tab';
import { ReportsTab } from './reports-tab';
import { ReviewsTab } from './reviews-tab';
import { StorefrontsTab } from './storefronts-tab';
import { SubscriptionsTab } from './subscriptions-tab';
import { WasteTab } from './waste-tab';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

// Lỗi tải chỉ hiện chữ đỏ thì nhân viên phải F5 cả trang và mất bộ lọc đang chọn (D7-19): mỗi tab có nút "Thử lại"
// tải lại đúng truy vấn vừa lỗi.
const TABS: [string, () => ReactElement][] = [
  ['Chấm công', () => <AttendanceTab />],
  ['Hoàn tiền sàn ngoài', () => <CashbackTab />],
  ['Voucher', () => <CouponList />],
  ['Lịch sử giá đại lý', () => <DealerPriceHistoryTab />],
  ['Nhiệm vụ & quà đổi điểm', () => <EngagementTab />],
  ['Tích điểm đơn sàn', () => <ExternalClaimsTab isAdmin canAct />],
  ['Đơn ngoài app', () => <ExternalOrdersTab isAdmin />],
  ['Đơn đối tác & đối soát', () => <MerchantFulfilmentTab isAdmin />],
  ['Duyệt SP đối tác', () => <MerchantProductsTab />],
  ['Mẫu thông báo', () => <NotificationTemplatesTab />],
  ['Sức khoẻ hệ thống', () => <OpsHealthTab />],
  ['Việc cần xử lý', () => <OpsInboxTab onOpen={() => undefined} />],
  ['Tích điểm tại quầy', () => <PosCreditsTab />],
  ['Báo cáo', () => <ReportsTab />],
  ['Đánh giá', () => <ReviewsTab />],
  ['Gian hàng', () => <StorefrontsTab />],
  ['Gói định kỳ', () => <SubscriptionsTab />],
  ['Đổi rác', () => <WasteTab isAdmin />],
];

describe('tab quản trị — lỗi tải có nút "Thử lại"', () => {
  it.each(TABS)('%s: nút Thử lại gọi lại API đã lỗi', async (_name, ui) => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify({ message: 'Máy chủ đang bận, vui lòng thử lại sau.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const r = render(ui());
    mounted.push(r);
    await flush();

    const retry = byText(r.container, 'button', 'Thử lại');
    expect(retry, 'không thấy nút Thử lại').not.toBeNull();
    const before = urls.length;
    click(retry);
    await flush();
    expect(urls.length).toBeGreaterThan(before);
  });
});
