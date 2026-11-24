'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { getCommandCenter, type CommandCenterBucket, type CommandCenterSummary } from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import { LoadError } from './ui';

/** Ba nhóm tiền chính của đơn hôm nay, theo thứ tự kế toán đối chiếu: tiền đã về, tiền chờ khách chuyển, tiền bưu tá thu. */
const MONEY: { key: 'paid' | 'bankTransferUnpaid' | 'cod'; label: string }[] = [
  { key: 'paid', label: 'Đã thanh toán' },
  { key: 'bankTransferUnpaid', label: 'Chờ chuyển khoản' },
  { key: 'cod', label: 'Thu khi giao (COD)' },
];

function MoneyCell({ label, bucket }: { label: string; bucket: CommandCenterBucket }) {
  return (
    <div role="group" aria-label={label} className="min-w-0">
      <span className="block truncate text-[11px] text-stone-600">{label}</span>
      <span className="block text-base font-bold text-stone-900">{bucket.count} đơn</span>
      <span className="block truncate text-[11px] text-stone-600">{formatVnd(bucket.amount)}</span>
    </div>
  );
}

/** Nhóm đơn không phải tiền Tubu đang thu hoặc chờ thu: chỉ nêu số đơn khi có, để tổng ba nhóm lệch số "Đơn hôm nay" vẫn giải thích được. */
const REST: { key: 'cancelled' | 'merchantCod' | 'pilot' | 'other'; label: string }[] = [
  { key: 'cancelled', label: 'Huỷ hoặc hoàn tiền' },
  { key: 'merchantCod', label: 'COD gian hàng tự thu' },
  { key: 'pilot', label: 'Đơn thử Giờ G' },
  { key: 'other', label: 'Chờ cổng thanh toán' },
];

export function restLine(o: CommandCenterSummary['ordersToday']): string {
  return REST.filter((r) => o[r.key].count > 0)
    .map((r) => `${r.label} ${o[r.key].count}`)
    .join(' · ');
}

const stockText = (n: number) => (n <= 0 ? 'hết hàng' : `còn ${n}`);

/**
 * Thẻ "Điều phối hôm nay" ở trang Hôm nay (chỉ ADMIN): tiền của đơn hôm nay theo cách trả, phân loại hàng kho Tubu sắp hết, hoa hồng CTV chưa chi.
 * Chỉ để xem: việc cần làm (xác nhận chuyển khoản, đơn Pancake...) đã có thẻ riêng ở "Việc đang chờ" ngay dưới, nên thẻ này không thêm nút dẫn
 * đi cho cùng việc. Lỗi tải chỉ thẻ này báo, không kéo sập trang.
 */
export function CommandCenterCard() {
  const q = useQuery({ queryKey: ['admin-command-center'], queryFn: getCommandCenter, refetchInterval: 60_000 });
  const [showLow, setShowLow] = useState(false);
  if (q.isLoading) return <div aria-busy="true" aria-label="Đang tải thẻ điều phối" className="h-40 animate-pulse rounded-card bg-stone-100" />;
  if (q.isError || !q.data) return <LoadError onRetry={() => void q.refetch()} retrying={q.isFetching}>Không tải được thẻ điều phối hôm nay.</LoadError>;
  const { ordersToday: o, lowStock: low, ctvPayouts: ctv } = q.data;
  const rest = restLine(o);
  const hidden = low.count - low.items.length;
  return (
    <section aria-labelledby="command-center-title" data-command-center className="divide-y divide-stone-100 rounded-card border border-stone-200 bg-stone-0 shadow-card">
      <div className="space-y-2 p-3">
        <h3 id="command-center-title" className="text-sm font-semibold text-stone-900">
          Điều phối hôm nay
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {MONEY.map((m) => (
            <MoneyCell key={m.key} label={m.label} bucket={o[m.key]} />
          ))}
        </div>
        {rest && <p className="text-[11px] text-stone-600">{rest}</p>}
      </div>

      <div className="px-3 py-2" role="group" aria-label="Hàng sắp hết">
        {low.count === 0 ? (
          <p className="py-1 text-sm text-stone-700">Không phân loại nào còn từ {low.threshold} trở xuống.</p>
        ) : (
          <>
            <button
              type="button"
              aria-expanded={showLow}
              onClick={() => setShowLow((v) => !v)}
              className="flex min-h-[44px] w-full items-center gap-2 text-left text-sm sm:min-h-[32px]"
            >
              <ChevronRight aria-hidden="true" className={`h-4 w-4 shrink-0 text-stone-500 transition-transform ${showLow ? 'rotate-90' : ''}`} />
              <span className="min-w-0 flex-1 text-stone-900">
                <span className="font-semibold text-warning-fg">{low.count}</span> phân loại còn từ {low.threshold} trở xuống
                {low.outOfStock > 0 && <span className="text-stone-600"> · {low.outOfStock} đã hết</span>}
              </span>
            </button>
            {showLow && (
              <ul className="mb-1 space-y-1 pl-6 text-xs text-stone-700">
                {low.items.map((i) => (
                  <li key={i.sku} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate" title={`${i.productName} · ${i.variationName} (${i.sku})`}>
                      {i.productName} · {i.variationName}
                    </span>
                    <span className={`shrink-0 ${i.stock <= 0 ? 'font-medium text-danger-fg' : 'text-stone-600'}`}>{stockText(i.stock)}</span>
                  </li>
                ))}
                {hidden > 0 && <li className="text-stone-500">và {hidden} phân loại khác</li>}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="p-3" role="group" aria-label="Hoa hồng CTV chờ chi">
        <p className="text-sm text-stone-900">
          Hoa hồng CTV chờ chi <span className="font-semibold">{formatVnd(ctv.approvedAmount)}</span>
          {ctv.approvedCtvs > 0 && <span className="text-stone-600"> · {ctv.approvedCtvs} CTV</span>}
        </p>
        <p className="mt-0.5 text-[11px] text-stone-600">
          {ctv.autoWalletTransfer ? 'Tự vào Ví lúc 8 giờ sáng mỗi ngày, trừ CTV bị khoá' : 'Đang tắt tự chuyển vào Ví, chờ CTV tự bấm'} · Đang giữ sau giao{' '}
          {formatVnd(ctv.holdingAmount)} · Đơn chưa giao {formatVnd(ctv.pendingAmount)}
          {ctv.withdrawingAmount > 0 && ` · Trong lệnh rút cũ ${formatVnd(ctv.withdrawingAmount)}`}
        </p>
      </div>
    </section>
  );
}
