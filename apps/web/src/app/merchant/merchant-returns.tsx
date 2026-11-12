'use client';

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listMerchantReturns, markMerchantReturnReceived, type MerchantReturn } from '@/lib/merchant-client';
import { formatDateTime } from '@/lib/format-date';
import { joinVariationLine, variationLabel } from '@/lib/variation-label';
import { BTN_XS_PRIMARY, ToneBadge } from '@/components/admin/ui';
import { EvidenceImages } from '@/components/admin/evidence-images';
import { actionErrorText } from '@/lib/error-text';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { settleWithin } from '@/lib/settle-within';
import { reloadWhenStale } from '@/lib/stale-write-rejection';

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
export function MerchantReturnsSection({ showEmpty = false }: { showEmpty?: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: MERCHANT_RETURNS_KEY, queryFn: listMerchantReturns });
  // Lời lỗi ở state riêng: `received.isError` chỉ lật sau khi Promise của onError xong, tức sau lần tải lại (tối đa 4 giây).
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['merchant-settlement'] });
    return qc.invalidateQueries({ queryKey: MERCHANT_RETURNS_KEY });
  };
  // Một yêu cầu mỗi lúc, giữ khoá tới khi danh sách hàng trả về làm mới (tối đa 4 giây): nhả sớm thì dòng vừa nhận còn nút và bấm lại ra lỗi (hoặc cộng kho hai lần nếu máy chủ không chặn).
  const received = useLockedMutation({
    mutationFn: (id: string) => markMerchantReturnReceived(id),
    onMutate: () => setError(null),
    onSuccess: () => settleWithin(refresh()),
    onError: (e: unknown) => {
      setError(actionErrorText(e));
      return reloadWhenStale(e, refresh);
    },
  });
  if (q.isError) return <p className="text-sm text-danger-fg">Không tải được danh sách hàng trả về.</p>;
  const rows = q.data ?? [];
  if (rows.length === 0) return showEmpty && !q.isLoading ? <p className="text-sm text-stone-600">Chưa có hàng khách trả về.</p> : null;
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
      {error && (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
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
                    {joinVariationLine(l.productName, variationLabel(l.variationName))} ×{l.quantity}
                  </li>
                ))}
              </ul>
              <p className="break-words text-stone-600">
                Lý do: {r.reasonLabel ? `${r.reasonLabel}. ` : ''}
                {r.reason && r.reason !== r.reasonLabel ? r.reason : ''}
              </p>
              <EvidenceImages images={r.images} />
              {r.receivedAt && <p className="text-stone-500">Đã nhận lúc {formatDateTime(r.receivedAt)}</p>}
              {r.status === 'APPROVED' && !r.receivedAt && (
                <button
                  type="button"
                  onClick={() => received.mutate(r.id)}
                  aria-busy={(received.isPending && received.variables === r.id) || undefined}
                  aria-disabled={received.isPending || undefined}
                  className={`${BTN_XS_PRIMARY} min-h-[44px] aria-disabled:opacity-60 sm:min-h-0`}
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
