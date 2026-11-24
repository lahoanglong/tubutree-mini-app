'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTransferPreview } from '@tubutree/app-core/api/payment';
import { transferPreviewView } from '@tubutree/app-core/commerce/checkout-display';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { coreHttp } from '@/lib/core-http';
import { trackWebEvent } from '@/lib/analytics';
import { formatVnd } from '@/lib/format-vnd';

export const TRANSFER_PREVIEW_KEY = ['transfer-preview'] as const;

/**
 * Thẻ ngay dưới lựa chọn "Chuyển khoản" (cờ `checkout.transfer_preview_enabled`): ngân hàng, chủ tài khoản, số tiền theo báo giá.
 * Không có mã QR: QR chỉ được vẽ khi đã có mã đơn làm nội dung chuyển khoản, nếu không khoản chuyển không đối soát được.
 */
export function TransferPreview({ total, dim = false }: { total: number | null; dim?: boolean }) {
  const q = useQuery({ queryKey: TRANSFER_PREVIEW_KEY, queryFn: () => getTransferPreview(coreHttp), staleTime: 5 * 60_000, retry: false });
  const view = transferPreviewView(q.data, total);
  const shown = useRef(false);
  useEffect(() => {
    if (!view || shown.current) return;
    shown.current = true;
    trackWebEvent('transfer_preview_shown', {});
  }, [view]);
  if (!view) return null;
  return (
    <div data-testid="transfer-preview" className="mb-2 mt-1 rounded-control bg-[var(--color-bg-subtle)] px-3 pb-2.5 pt-1.5 text-sm md:mb-0 md:ml-8">
      <PreviewRow label={fillCopy('checkout.transferBank')} value={view.bankName} />
      <PreviewRow label={fillCopy('checkout.transferHolder')} value={view.accountName} />
      <PreviewRow label={fillCopy('checkout.transferAmount')} value={formatVnd(view.amount)} dim={dim} />
      <p className="mt-1 text-caption text-[color:var(--color-text-secondary)]">{fillCopy('checkout.transferNote')}</p>
    </div>
  );
}

function PreviewRow({ label, value, dim = false }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className={`flex justify-between gap-2.5 py-1.5 ${dim ? 'opacity-50' : ''}`}>
      <span className="shrink-0 text-[color:var(--color-text-secondary)]">{label}</span>
      <span className="min-w-0 break-words text-right font-semibold tabular-nums text-[color:var(--color-text-primary)]">{value}</span>
    </div>
  );
}
