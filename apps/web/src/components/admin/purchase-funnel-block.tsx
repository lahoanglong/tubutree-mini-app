'use client';

import { useQuery } from '@tanstack/react-query';
import { PURCHASE_FUNNEL_STEPS, type PurchaseFunnelDTO, type PurchaseFunnelRow, type PurchaseFunnelStep } from '@tubutree/shared-types';
import { apiFetch } from '@/lib/client-api';
import { ListSkeleton, LoadError, ScrollRegion } from '@/components/admin/ui';
import { formatCount, formatPct, ratioPct } from '@/components/admin/launch-watch-format';

/** Nhãn từng bước; Record ép khai đủ khi thêm bước vào `PURCHASE_FUNNEL_STEPS`. */
export const PURCHASE_STEP_LABELS: Record<PurchaseFunnelStep, string> = {
  product_viewed: 'Xem trang sản phẩm',
  add_or_buy: 'Bấm Thêm vào giỏ hoặc Mua ngay',
  checkout_started: 'Vào thanh toán',
  place_order_click: 'Bấm Đặt hàng',
  order_placed: 'Đặt đơn thành công',
};

export const getPurchaseFunnel = () => apiFetch<PurchaseFunnelDTO>('/admin/analytics/purchase-funnel');

/** Mỗi bước kèm % số phiên so với bước đầu (cột Tổng); null khi chưa có phiên nào xem sản phẩm. */
export function purchaseRowsWithPct(rows: readonly PurchaseFunnelRow[]): Array<PurchaseFunnelRow & { label: string; pctOfFirst: number | null }> {
  const byStep = new Map(rows.map((r) => [r.step, r]));
  const first = byStep.get('product_viewed')?.total ?? 0;
  return PURCHASE_FUNNEL_STEPS.map((step) => {
    const r = byStep.get(step) ?? { step, web: 0, miniapp: 0, total: 0 };
    return { ...r, label: PURCHASE_STEP_LABELS[step], pctOfFirst: ratioPct(r.total, first) };
  });
}

export function PurchaseFunnelBlock({ win }: { win: keyof PurchaseFunnelDTO['windows'] }) {
  const q = useQuery({ queryKey: ['admin-purchase-funnel'], queryFn: getPurchaseFunnel });
  const w = q.data?.windows[win];
  return (
    <section aria-label="Phễu mua">
      <h3 className="text-base font-semibold text-stone-900">Phễu mua</h3>
      <p className="mt-0.5 text-xs text-stone-500">
        Số phiên có từng bước (phiên đổi sau 30 phút không thao tác). Một phiên có thể bỏ qua bước trước, ví dụ Mua ngay ở Giờ vàng không qua trang sản phẩm.
        Khách bật Do Not Track trên web không được đếm.
      </p>
      <div className="mt-2">
        {q.isLoading ? (
          <ListSkeleton label="Đang tải phễu mua" rows={3} className="h-16" />
        ) : q.isError || !w ? (
          <LoadError message="Không tải được phễu mua." onRetry={() => q.refetch()} retrying={q.isFetching} />
        ) : (
          <>
            <ScrollRegion label="Phễu mua theo bước">
              <table className="w-full min-w-[460px] text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-stone-500">
                    <th scope="col" className="py-1 pr-2 font-medium">Bước</th>
                    <th scope="col" className="px-2 text-right font-medium">Web</th>
                    <th scope="col" className="px-2 text-right font-medium">Mini App</th>
                    <th scope="col" className="px-2 text-right font-medium">Tổng</th>
                    <th scope="col" className="pl-2 text-right font-medium">So với bước đầu</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseRowsWithPct(w.rows).map((r) => (
                    <tr key={r.step} className="border-t border-stone-200">
                      <th scope="row" className="py-2 pr-2 text-left font-normal text-stone-900">{r.label}</th>
                      <td className="px-2 text-right">{formatCount(r.web)}</td>
                      <td className="px-2 text-right">{formatCount(r.miniapp)}</td>
                      <td className="px-2 text-right font-medium">{formatCount(r.total)}</td>
                      <td className="pl-2 text-right text-stone-700">{formatPct(r.pctOfFirst)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
            <p className="mt-2 text-sm text-stone-900 tabular-nums">
              Tổng số phiên: <strong>{formatCount(w.sessions.total)}</strong> (web {formatCount(w.sessions.web)} · Mini App {formatCount(w.sessions.miniapp)})
            </p>
          </>
        )}
      </div>
    </section>
  );
}
