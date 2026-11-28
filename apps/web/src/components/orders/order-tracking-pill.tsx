'use client';

// Nguồn: apps/miniapp/src/components/orders/order-tracking-pill.tsx (web chép bằng clipboard của trình duyệt)
import { useEffect, useRef, useState } from 'react';
import { Copy, Truck } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Text } from '@/components/mini/text';
import { copyText } from '@/lib/copy-text';

export interface OrderTrackingPillProps {
  /** Mã vận đơn của hãng. */
  code: string;
  partner?: string | null;
}

const COPIED_MS = 2000;
const FAILED_MS = 4000;

/** Nhãn đọc của nút chép mã: viên in cả hãng cạnh mã nên nói hãng (khách biết dán mã vào trang nào); chưa có hãng thì chỉ đọc mã. */
export const copyTrackingLabel = (code: string, partner?: string | null) =>
  partner ? fillCopy('order.shipping.copyAriaPartner', { code, partner }) : fillCopy('order.shipping.copyAria', { code });

/**
 * Viên mã vận đơn trong thẻ Vận chuyển của Chi tiết đơn (`OrderShipping`), cùng hình và cùng hành vi với Mini App: chạm là chép mã, báo tại chỗ (tự tắt sau
 * 2 giây khi chép được, 4 giây khi không), khoá chạm đúp. Là nút chép DUY NHẤT của trang; lối tra cứu trang hãng nằm cạnh trong thẻ (`trackingHref`).
 */
export function OrderTrackingPill({ code, partner }: OrderTrackingPillProps) {
  // `n` đếm số lần báo: chạm lần hai (cùng chữ) vẫn dựng lại lời báo để trình đọc màn hình đọc lại.
  const [result, setResult] = useState<{ ok: boolean; n: number } | null>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const ok = await copyText(code);
      clearTimeout(timer.current);
      setResult((prev) => ({ ok, n: (prev?.n ?? 0) + 1 }));
      timer.current = setTimeout(() => setResult(null), ok ? COPIED_MS : FAILED_MS);
    } finally {
      busy.current = false;
    }
  };
  return (
    <div data-testid="order-tracking-pill">
      <button
        type="button"
        aria-label={copyTrackingLabel(code, partner)}
        onClick={() => void copy()}
        className="tubu-press inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-4 text-sm font-semibold text-[color:var(--color-text-brand)]"
      >
        <Truck className="h-4 w-4 flex-none" aria-hidden="true" />
        {/* Mã dài cùng tên hãng ở 360px không vừa một dòng: xuống dòng thay vì cắt "…", khách đối chiếu hay khiếu nại cần đủ mã. */}
        <span className="min-w-0 text-left tabular-nums text-[color:var(--color-text-primary)] [overflow-wrap:anywhere]">
          {code}
          {partner && <span className="font-normal text-[color:var(--color-text-secondary)]"> · {partner}</span>}
        </span>
        <span className="flex-none">{fillCopy('order.shipping.copy')}</span>
        <Copy className="h-4 w-4 flex-none" aria-hidden="true" />
      </button>
      {/* Vùng báo phải có sẵn trong trang trước khi bấm thì trình đọc màn hình mới đọc lúc chữ đổi; rỗng nên không chiếm chỗ. */}
      <div role="status">
        {result?.ok && (
          <Text key={result.n} variant="caption" tone="success" as="div">
            Đã sao chép mã vận đơn
          </Text>
        )}
      </div>
      {/* Lỗi hiện sau một lần chạm nên là role="alert" (đọc ngay); dựng riêng khỏi vùng status để chữ thành công không lẫn vào. */}
      {result && !result.ok && (
        <div role="alert" key={result.n}>
          <Text variant="caption" tone="danger" as="div">
            Không sao chép được — hãy chép mã thủ công.
          </Text>
        </div>
      )}
    </div>
  );
}
