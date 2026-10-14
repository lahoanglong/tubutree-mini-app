'use client';

import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listMerchantReturns, markMerchantReturnReceived, type MerchantReturn } from '@/lib/merchant-client';
import { formatDateTime } from '@/lib/format-date';
import { BTN_XS_PRIMARY, ToneBadge } from '@/components/admin/ui';

export const MERCHANT_RETURNS_KEY = ['merchant-returns'] as const;

function stateOf(r: MerchantReturn): { tone: 'warning' | 'info' | 'success'; label: string } {
  if (r.status === 'REQUESTED') return { tone: 'info', label: 'Tubu đang xét' };
  if (!r.receivedAt) return { tone: 'warning', label: 'Chờ bạn nhận hàng' };
  return { tone: 'success', label: 'Đã nhận, đã cộng kho' };
}

/**
 * "Hàng trả về": yêu cầu trả hàng của đơn gian hàng tự giao. Tubu Tree xét và hoàn tiền cho khách; hàng về gian hàng, gian hàng
 * bấm "Đã nhận hàng trả" thì tồn kho sản phẩm mới được cộng lại. Ẩn hẳn khi không có yêu cầu nào.
 */
export function MerchantReturnsSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: MERCHANT_RETURNS_KEY, queryFn: listMerchantReturns });
  const received = useMutation({
    mutationFn: (id: string) => markMerchantReturnReceived(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MERCHANT_RETURNS_KEY });
      void qc.invalidateQueries({ queryKey: ['merchant-settlement'] });
    },
  });
  if (q.isError) return <p className="text-sm text-danger-fg">Không tải được danh sách hàng trả về.</p>;
  const rows = q.data ?? [];
  if (rows.length === 0) return null;
  const waiting = rows.filter((r) => r.status === 'APPROVED' && !r.receivedAt).length;

  return (
    <section aria-label="Hàng khách trả về" className="space-y-2">
      <h2 className="font-display font-semibold text-stone-900">
        Hàng khách trả về{waiting > 0 ? ` (${waiting} chờ nhận)` : ''}
      </h2>
      <p className="text-xs text-stone-600">
        Tubu Tree xét và hoàn tiền cho khách. Khi nhận được hàng, bấm &quot;Đã nhận hàng trả&quot; để cộng lại tồn kho; phần đã đối
        soát cho đơn được trừ lại ở kỳ sau.
      </p>
      {received.isError && (
        <p role="alert" className="text-sm text-danger-fg">
          {received.error instanceof Error ? received.error.message : 'Không ghi nhận được.'}
        </p>
      )}
      <ul className="space-y-2">
        {rows.map((r) => {
          const st = stateOf(r);
          return (
            <li key={r.id} className="space-y-1.5 rounded-card border border-stone-200 bg-stone-0 p-3 text-xs shadow-card">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-stone-900">Đơn {r.orderCode}</span>
                <ToneBadge tone={st.tone}>{st.label}</ToneBadge>
                {r.fullReturn && <span className="text-stone-600">Trả cả đơn</span>}
                <span className="ml-auto text-stone-500">Yêu cầu {formatDateTime(r.createdAt)}</span>
              </div>
              <ul className="text-stone-800">
                {r.lines.map((l, i) => (
                  <li key={i} className="break-words">
                    {l.productName}
                    {l.variationName ? ` · ${l.variationName}` : ''} ×{l.quantity}
                  </li>
                ))}
              </ul>
              <p className="break-words text-stone-600">
                Lý do: {r.reasonLabel ? `${r.reasonLabel}. ` : ''}
                {r.reason && r.reason !== r.reasonLabel ? r.reason : ''}
              </p>
              {r.receivedAt && <p className="text-stone-500">Đã nhận lúc {formatDateTime(r.receivedAt)}</p>}
              {r.status === 'APPROVED' && !r.receivedAt && (
                <button
                  type="button"
                  onClick={() => received.mutate(r.id)}
                  disabled={received.isPending}
                  className={`${BTN_XS_PRIMARY} min-h-[44px] sm:min-h-0`}
                >
                  {received.isPending && received.variables === r.id ? 'Đang ghi nhận…' : 'Đã nhận hàng trả'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
