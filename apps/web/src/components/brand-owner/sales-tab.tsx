'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BRAND_OWNER_NO_ORDERS, BRAND_OWNER_REVENUE_NOTE } from '@tubutree/app-core/client-copy';
import { Package, ShoppingBag, Wallet, type LucideIcon } from 'lucide-react';
import { ownedBrandSalesQuery } from '@tubutree/app-core/queries/brand-owner';
import type { BrandSalesPeriod } from '@tubutree/app-core/api/brand-owner';
import { errorStatus } from '@tubutree/app-core/api/error-status';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { ownerLoadError, SALES_PERIODS } from '@/lib/brand-owner-view';
import { skin } from '@/components/pro-shared/mini-skin';
import { ErrorState } from '@/components/ui/error-state';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { Skeleton } from '@/components/ui/skeleton';

function Stat({ icon: Icon, label, value, wide }: { icon: LucideIcon; label: string; value: string; wide?: boolean }) {
  return (
    <div className={`${skin.card} p-3 md:p-4 lg:flex lg:items-center lg:gap-3 ${wide ? 'col-span-2 lg:col-span-1' : ''}`}>
      <span className="flex h-5 w-5 flex-none items-center justify-center text-forest-600 lg:h-10 lg:w-10 lg:rounded-full lg:bg-forest-50">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 max-lg:contents lg:flex lg:flex-col-reverse">
        <div className="mt-1 font-display text-[length:var(--type-title-lg-size)] font-semibold leading-[var(--type-title-lg-lh)] tabular-nums text-stone-900 lg:mt-0 lg:font-ui lg:text-lg lg:font-bold lg:leading-normal">{value}</div>
        <div className="text-xs text-[var(--color-text-tertiary)] lg:text-stone-600">{label}</div>
      </div>
    </div>
  );
}

/** Tab chỉ-đọc "Doanh thu" (Q-18): số đơn, doanh thu, SP bán chạy theo kỳ; máy chủ không trả thông tin khách. */
export function SalesTab() {
  const [period, setPeriod] = useState<BrandSalesPeriod>('30d');
  const q = useQuery({ ...ownedBrandSalesQuery(coreHttp, period), staleTime: 30_000, retry: false });
  const d = q.data;

  return (
    <div className="flex flex-col gap-3 pb-6">
      <SegmentedTabs scroll items={SALES_PERIODS} value={period} onChange={(k) => setPeriod(k as BrandSalesPeriod)} label="Kỳ báo cáo" />

      {q.isLoading ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 lg:grid-cols-3">
          <Skeleton height={84} rounded="rounded-card" />
          <Skeleton height={84} rounded="rounded-card" />
        </div>
      ) : !d ? (
        <ErrorState variant="inline" message={ownerLoadError(q.error)} onRetry={errorStatus(q.error) === 403 ? undefined : () => q.refetch()} />
      ) : d.orderCount === 0 ? (
        <section aria-label="Chưa có đơn" className={`p-8 text-center ${skin.card}`}>
          <h2 className="font-display text-base font-semibold text-stone-900">Chưa có đơn nào trong kỳ này</h2>
          <p className="mt-1 text-sm text-stone-600">{BRAND_OWNER_NO_ORDERS}</p>
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
            <Stat icon={Wallet} label="Doanh thu" value={formatVnd(d.revenue)} wide />
            <Stat icon={ShoppingBag} label="Số đơn" value={String(d.orderCount)} />
            <Stat icon={Package} label="Sản phẩm đã bán" value={String(d.unitsSold)} />
          </div>
          <p className="text-xs text-stone-600">
            {d.delivered.orderCount} đơn đã giao · {formatVnd(d.delivered.revenue)}
          </p>
          <section aria-label="Sản phẩm bán chạy" className={`${skin.plain} p-0 md:p-4`}>
            <h2 className="mb-2 mt-2 text-base font-display md:mt-0 md:font-ui font-semibold text-stone-900">Sản phẩm bán chạy</h2>
            <ol>
              {d.topProducts.map((p, i) => (
                <li key={p.productId} className="flex min-h-11 items-center gap-3 border-b border-stone-200 py-2 last:border-b-0">
                  <span className="w-5 text-center text-sm font-semibold text-stone-600">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-stone-900 [overflow-wrap:anywhere]">{p.name}</div>
                    <div className="text-xs text-stone-600">Đã bán {p.quantity}</div>
                  </div>
                  <span className="text-sm font-bold tabular-nums text-stone-900">{formatVnd(p.revenue)}</span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      <p className="text-xs text-stone-600">{BRAND_OWNER_REVENUE_NOTE}</p>
    </div>
  );
}
