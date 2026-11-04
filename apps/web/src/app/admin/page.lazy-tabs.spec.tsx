// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/query-client';
import AdminPage from './page';

// Mỗi module tab ở đây được thay bằng bản giả ghi lại việc nó bị nạp: khoá import tĩnh sẽ nạp ngay khi page.tsx được nạp.
const loaded = vi.hoisted(() => [] as string[]);
const authRenders = vi.hoisted(() => ({ n: 0 }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => {
    authRenders.n++;
    return { user: { role: 'ADMIN' }, status: 'authenticated', initialized: true };
  },
}));
vi.mock('@/components/admin/dealer-claims-tab', () => {
  loaded.push('dealer-claims-tab');
  return { DealerClaimsTab: () => <div data-tab="DealerClaimsTab" /> };
});
vi.mock('@/components/admin/dealer-accounts-tab', () => {
  loaded.push('dealer-accounts-tab');
  return { DealerAccountsTab: () => <div data-tab="DealerAccountsTab" /> };
});
vi.mock('@/components/admin/dealer-price-history-tab', () => {
  loaded.push('dealer-price-history-tab');
  return { DealerPriceHistoryTab: () => <div data-tab="DealerPriceHistoryTab" /> };
});
vi.mock('@/components/admin/commission-rates-tab', () => {
  loaded.push('commission-rates-tab');
  return { CommissionRatesTab: () => <div data-tab="CommissionRatesTab" /> };
});
vi.mock('@/components/admin/product-categories-tab', () => {
  loaded.push('product-categories-tab');
  return { ProductCategoriesTab: () => <div data-tab="ProductCategoriesTab" /> };
});
vi.mock('@/components/admin/engagement-tab', () => {
  loaded.push('engagement-tab');
  return { EngagementTab: () => <div data-tab="EngagementTab" /> };
});
vi.mock('@/components/admin/external-orders-tab', () => {
  loaded.push('external-orders-tab');
  return { ExternalOrdersTab: () => <div data-tab="ExternalOrdersTab" /> };
});
vi.mock('@/components/admin/external-claims-tab', () => {
  loaded.push('external-claims-tab');
  return { ExternalClaimsTab: () => <div data-tab="ExternalClaimsTab" /> };
});
vi.mock('@/components/admin/support-chat-tab', () => {
  loaded.push('support-chat-tab');
  return { SupportChatTab: () => <div data-tab="SupportChatTab" /> };
});
vi.mock('@/components/admin/payout-admin-tab', () => {
  loaded.push('payout-admin-tab');
  return { PayoutAdminTab: () => <div data-tab="PayoutAdminTab" /> };
});
vi.mock('@/components/admin/customer-refunds-tab', () => {
  loaded.push('customer-refunds-tab');
  return { CustomerRefundsTab: () => <div data-tab="CustomerRefundsTab" /> };
});
vi.mock('@/components/admin/cashback-tab', () => {
  loaded.push('cashback-tab');
  return { CashbackTab: () => <div data-tab="CashbackTab" /> };
});
vi.mock('@/components/admin/pos-credits-tab', () => {
  loaded.push('pos-credits-tab');
  return { PosCreditsTab: () => <div data-tab="PosCreditsTab" /> };
});
vi.mock('@/components/admin/reviews-tab', () => {
  loaded.push('reviews-tab');
  return { ReviewsTab: () => <div data-tab="ReviewsTab" /> };
});
vi.mock('@/components/admin/subscriptions-tab', () => {
  loaded.push('subscriptions-tab');
  return { SubscriptionsTab: () => <div data-tab="SubscriptionsTab" /> };
});
vi.mock('@/components/admin/ops-health-tab', () => {
  loaded.push('ops-health-tab');
  return { OpsHealthTab: () => <div data-tab="OpsHealthTab" /> };
});
vi.mock('@/components/admin/attendance-tab', () => {
  loaded.push('attendance-tab');
  return { AttendanceTab: () => <div data-tab="AttendanceTab" /> };
});
vi.mock('@/components/admin/staff-roster-tab', () => {
  loaded.push('staff-roster-tab');
  return { StaffRosterTab: () => <div data-tab="StaffRosterTab" /> };
});
vi.mock('@/components/admin/shift-approval-tab', () => {
  loaded.push('shift-approval-tab');
  return { ShiftApprovalTab: () => <div data-tab="ShiftApprovalTab" /> };
});
vi.mock('@/components/admin/payroll-admin-tab', () => {
  loaded.push('payroll-admin-tab');
  return { PayrollAdminTab: () => <div data-tab="PayrollAdminTab" /> };
});
vi.mock('@/components/admin/storefronts-tab', () => {
  loaded.push('storefronts-tab');
  return { StorefrontsTab: () => <div data-tab="StorefrontsTab" /> };
});
vi.mock('@/components/admin/merchant-products-tab', () => {
  loaded.push('merchant-products-tab');
  return { MerchantProductsTab: () => <div data-tab="MerchantProductsTab" /> };
});
vi.mock('@/components/admin/merchant-fulfilment-tab', () => {
  loaded.push('merchant-fulfilment-tab');
  return { MerchantFulfilmentTab: () => <div data-tab="MerchantFulfilmentTab" /> };
});
vi.mock('@/components/admin/campaigns-tab', () => {
  loaded.push('campaigns-tab');
  return { CampaignsTab: () => <div data-tab="CampaignsTab" /> };
});
vi.mock('@/components/admin/bundles-tab', () => {
  loaded.push('bundles-tab');
  return { BundlesTab: () => <div data-tab="BundlesTab" /> };
});
vi.mock('@/components/admin/notification-templates-tab', () => {
  loaded.push('notification-templates-tab');
  return { NotificationTemplatesTab: () => <div data-tab="NotificationTemplatesTab" /> };
});
vi.mock('@/components/admin/reports-tab', () => {
  loaded.push('reports-tab');
  return { ReportsTab: () => <div data-tab="ReportsTab" /> };
});
vi.mock('@/components/admin/waste-tab', () => {
  loaded.push('waste-tab');
  return { WasteTab: () => <div data-tab="WasteTab" /> };
});
vi.mock('@/components/admin/community-moderation-tab', () => {
  loaded.push('community-moderation-tab');
  return { CommunityModerationTab: () => <div data-tab="CommunityModerationTab" /> };
});
vi.mock('./analytics-tab', () => {
  loaded.push('analytics-tab');
  return { AnalyticsTab: () => <div data-tab="AnalyticsTab" /> };
});

describe('admin/page — tab tải lười (F5)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } }));
    window.history.replaceState(null, '', '/admin');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mở trang vào tab mặc định không nạp module của tab khác', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <QueryClientProvider client={createQueryClient()}>
          <AdminPage />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(host.querySelector('nav[aria-label="Mục quản trị"]')).not.toBeNull();
    expect(loaded).toEqual([]);
    await act(async () => root.unmount());
    host.remove();
  });

  it('F12 — lượt poll hộp việc không dựng lại AdminPage (observer poll là component lá)', async () => {
    let inboxCalls = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('/admin/ops/inbox')) inboxCalls++;
      return new Response(JSON.stringify({ generatedAt: '2026-11-04T00:00:00.000Z', items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.useFakeTimers();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <QueryClientProvider client={createQueryClient()}>
          <AdminPage />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const rendersBefore = authRenders.n;
    const callsBefore = inboxCalls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(inboxCalls).toBeGreaterThan(callsBefore);
    expect(authRenders.n).toBe(rendersBefore);
    vi.useRealTimers();
    await act(async () => root.unmount());
    host.remove();
  });
});
