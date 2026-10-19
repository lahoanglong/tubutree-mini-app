'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
    <div className={`flex items-center gap-3 p-4 ${skin.card} ${wide ? 'col-span-2 lg:col-span-1' : ''}`}>
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-forest-50 text-forest-600">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-stone-600">{label}</div>
        <div className="text-lg font-bold tabular-nums text-stone-900">{value}</div>
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
        <div className="grid gap-2.5 lg:grid-cols-3">
          <Skeleton height={84} rounded="rounded-card" />
          <Skeleton height={84} rounded="rounded-card" />
        </div>
      ) : !d ? (
        <ErrorState message={ownerLoadError(q.error)} onRetry={errorStatus(q.error) === 403 ? undefined : () => void q.refetch()} />
      ) : d.orderCount === 0 ? (
        <section aria-label="Chưa có đơn" className={`p-8 text-center ${skin.card}`}>
          <h2 className="font-display text-base font-semibold text-stone-900">Chưa có đơn nào trong kỳ này</h2>
          <p className="mt-1 text-sm text-stone-600">Khi khách đặt sản phẩm của nhãn, số liệu sẽ hiện ở đây.</p>
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
          <section aria-label="Sản phẩm bán chạy" className={`p-4 ${skin.card}`}>
            <h2 className="mb-2 text-base font-semibold text-stone-900">Sản phẩm bán chạy</h2>
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

      <p className="text-xs text-stone-600">
        Doanh thu là giá bán sản phẩm của nhãn trong các đơn đã xác nhận (chưa trừ mã giảm giá của đơn, chưa gồm phí vận chuyển; không tính đơn chờ
        thanh toán, đã huỷ, đã trả hoặc đã hoàn tiền). Số liệu tổng hợp, không hiện thông tin khách.
      </p>
    </div>
  );
}
