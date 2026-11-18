import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTransferPreview } from '@tubutree/app-core/api/payment';
import { transferPreviewView } from '@tubutree/app-core/commerce/checkout-display';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { coreHttp } from '../../services/core-http';
import { trackEvent } from '../../services/analytics';
import { formatVnd } from '../../utils/format';
import { KeyValueRow } from '../ui/key-value-row';
import { Text } from '../ui/text';

export const TRANSFER_PREVIEW_KEY = ['transfer-preview'] as const;

/**
 * Làm nóng trang QR khi khách chọn Chuyển khoản: tải sẵn chunk của màn `/bank-payment` và mở sẵn kết nối tới máy chủ ảnh VietQR,
 * để sau khi bấm Đặt hàng chỉ còn chờ đúng một lời gọi `/payments/bank-qr/:code`.
 */
export function warmBankPayment(): void {
  void import('../../pages/bank-payment').catch(() => undefined);
  if (typeof document === 'undefined' || document.querySelector('link[data-warm="vietqr"]')) return;
  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = 'https://img.vietqr.io';
  link.crossOrigin = 'anonymous';
  link.dataset.warm = 'vietqr';
  document.head.appendChild(link);
}

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
    trackEvent('transfer_preview_shown', 'miniapp', {});
  }, [view]);
  if (!view) return null;
  return (
    <div
      data-testid="transfer-preview"
      style={{
        margin: '0 0 var(--space-stack-sm)',
        padding: 'var(--space-stack-xs) var(--space-inline-md) var(--space-stack-sm)',
        borderRadius: 'var(--radius-control)',
        background: 'var(--color-bg-subtle)',
      }}
    >
      <KeyValueRow label={fillCopy('checkout.transferBank')} value={view.bankName} />
      <KeyValueRow label={fillCopy('checkout.transferHolder')} value={view.accountName} />
      <KeyValueRow label={fillCopy('checkout.transferAmount')} value={formatVnd(view.amount)} style={dim ? { opacity: 0.5 } : undefined} />
      <Text variant="caption" tone="secondary" as="p" style={{ margin: 'var(--space-stack-xs) 0 0' }}>
        {fillCopy('checkout.transferNote')}
      </Text>
    </div>
  );
}
