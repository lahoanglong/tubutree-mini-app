'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { dealerMeQuery } from '@tubutree/app-core/queries/dealer';
import { PARTNER_STOREFRONT_TITLE } from '@tubutree/app-core/dealer-apply-copy';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { SegmentedTabs, useTabParam } from '@/components/ui/segmented-tabs';
import { DealerShell } from './dealer-shell';
import { PriceTab } from './price-tab';
import { OrdersTab } from './orders-tab';
import { CreditTab } from './credit-tab';
import { ReportTab } from './report-tab';

const TABS = [
  { key: 'price', label: 'Bảng giá' },
  { key: 'orders', label: 'Đơn hàng' },
  { key: 'credit', label: 'Công nợ' },
  { key: 'report', label: 'Báo cáo' },
] as const;
const TAB_KEYS = TABS.map((t) => t.key);

function HubBody() {
  const [tab, setTab] = useTabParam(TAB_KEYS, 'price');
  const meQ = useQuery(dealerMeQuery(coreHttp));
  const me = meQ.data;

  return (
    <DealerShell title="Kênh đại lý">
      <section aria-label="Tổng quan đại lý" className="rounded-card bg-stone-900 p-4 text-stone-0 max-md:bg-[var(--color-dealer-ink)]">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs text-stone-100">Bậc đại lý</div>
            <div className="font-display text-lg font-semibold">{me?.tier?.name ?? 'Đang gán bậc'}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-stone-100">Công nợ hiện tại</div>
            <div className="font-display text-lg font-semibold tabular-nums">{formatVnd(me?.currentDebt ?? 0)}</div>
          </div>
        </div>
        {me?.tier && <div className="mt-2 text-xs text-stone-100">Hạn mức: {formatVnd(me.tier.creditLimit)}</div>}
      </section>

      {me?.hasPartnerStorefront && (
      <section data-testid="partner-storefront-note" className="mt-3 rounded-card border border-stone-200 bg-stone-0 p-3">
        <h2 className="text-sm font-semibold text-stone-900">{PARTNER_STOREFRONT_TITLE}</h2>
        <p className="mt-0.5 text-xs text-stone-600">Quản lý sản phẩm, đơn và đối soát của gian hàng đối tác tại trang riêng.</p>
        <Link href="/merchant" className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-forest-700 underline">
          Mở trang quản lý
        </Link>
      </section>
      )}

      <div className="mt-3">
        <SegmentedTabs items={[...TABS]} value={tab} onChange={setTab} label="Mục của kênh đại lý" />
      </div>

      <div className="mt-3">
        {tab === 'price' && <PriceTab creditLimit={me?.tier?.creditLimit ?? 0} debt={me?.currentDebt ?? 0} rules={me?.orderRules} />}
        {tab === 'orders' && <OrdersTab />}
        {tab === 'credit' && <CreditTab />}
        {tab === 'report' && <ReportTab />}
      </div>
    </DealerShell>
  );
}

/** Hub đại lý đã duyệt. Tab đang chọn lưu ở `?tab=`. */
export function DealerHub() {
  return (
    <Suspense fallback={null}>
      <HubBody />
    </Suspense>
  );
}
