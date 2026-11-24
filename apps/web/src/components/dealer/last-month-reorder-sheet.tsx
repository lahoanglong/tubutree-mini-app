'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { placeDealerLastMonthReorder } from '@tubutree/app-core/api/dealer';
import { dealerLastMonthReorderQuery } from '@tubutree/app-core/queries/dealer';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { newIdempotencyKey } from '@/lib/idempotency-key';
import { settleWithin } from '@/lib/settle-within';
import { serverRejectedState } from '@/lib/server-rejected-state';
import { ui } from '@/lib/guest-ui';
import { skin } from '@/components/pro-shared/mini-skin';
import { ErrorState } from '@/components/ui/error-state';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { errText } from './dealer-shell';
import { DEALER_ORDER_PLACED_KEYS, DEALER_ORDER_REFRESH_KEYS, creditAfterText, type ReorderRequest } from './dealer-order-tools';

type Notice = { text: string; error: boolean };

function Row({ label, value, strong, danger }: { label: string; value: string; strong?: boolean; danger?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-stone-600">{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-bold' : ''} ${danger ? 'text-danger-fg' : 'text-stone-900'}`}>{value}</dd>
    </div>
  );
}

/**
 * Sheet "Đặt lại đơn tháng trước": gộp các đơn sỉ đã nhận của tháng trước theo giá hôm nay. Mỗi lần mở đọc lại bản xem trước (giá, tồn, dư nợ
 * và hạn mức còn lại), nên số trên sheet là số máy chủ vừa kiểm. Nút "Ghi công nợ" chỉ bật khi máy chủ không chặn; lệnh đặt gửi kèm dấu của bản
 * xem trước, giá đổi giữa chừng thì máy chủ trả 409 và sheet tải lại số mới. "Sửa trong giỏ" đưa các dòng sang giỏ của bảng giá (giảm số
 * lượng, hoặc chọn Trả trước khi vượt hạn mức).
 */
export function LastMonthReorderSheet({
  open,
  onClose,
  onEditInCart,
  onPlaced,
}: {
  open: boolean;
  onClose: () => void;
  onEditInCart: (r: ReorderRequest) => void;
  onPlaced: (n: Notice) => void;
}) {
  const qc = useQueryClient();
  const q = useQuery(dealerLastMonthReorderQuery(coreHttp));
  const { refetch } = q;
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null);
    setChecking(true);
    void refetch().finally(() => {
      if (live) setChecking(false);
    });
    return () => {
      live = false;
    };
  }, [open, refetch]);

  // Giữ khoá qua mọi lần bấm lại tới khi đặt xong (mạng lỗi, 409 giá đổi): máy chủ trả lại đơn đã tạo cho cùng khoá, nên không ghi nợ hai lần.
  const orderKey = useRef(newIdempotencyKey());
  const place = useLockedMutation({
    mutationFn: (quote: string) => placeDealerLastMonthReorder(coreHttp, quote, orderKey.current),
    onMutate: () => setError(null),
    onSuccess: (order) => {
      orderKey.current = newIdempotencyKey();
      const preorder = order.items?.some((it) => (it.backorderedQty ?? 0) > 0) ?? false;
      onPlaced({
        text: `Đã tạo đơn ${order.code} ghi công nợ ${formatVnd(order.total)}.${preorder ? ' Đơn sẽ giao khi đủ hàng, giữ giá hôm nay.' : ''}`,
        error: false,
      });
      return settleWithin(Promise.all(DEALER_ORDER_PLACED_KEYS.map((key) => qc.invalidateQueries({ queryKey: [key] }))));
    },
    // Máy chủ từ chối (giá đổi, vượt hạn mức, quá hạn): tải lại số liệu, sheet hiện bản xem trước mới rồi mới nhả nút.
    onError: (e) => {
      setError(errText(e));
      if (!serverRejectedState(e)) return undefined;
      return settleWithin(Promise.all(DEALER_ORDER_REFRESH_KEYS.map((key) => qc.invalidateQueries({ queryKey: [key] }))));
    },
  });

  const data = q.data;
  const placing = place.isPending;
  const loading = checking || (q.isLoading && !data);
  const canPlace = !!data && !data.block && !loading && !q.isFetching;
  const blockMessage = data?.block && data.block.code !== 'NO_ORDERS' ? data.block.message : null;
  const title = data ? `Đặt lại đơn tháng ${data.month}` : 'Đặt lại đơn tháng trước';

  const footer =
    data && !loading && data.lines.length > 0 ? (
      <div className="flex flex-col gap-1">
        {/* Đang đặt giữ aria-busy/aria-disabled chứ không `disabled`: nút đang giữ focus mà bị vô hiệu thì Chromium thả focus về body. */}
        <button
          type="button"
          disabled={!canPlace && !placing}
          aria-busy={placing || undefined}
          aria-disabled={placing || undefined}
          onClick={() => place.mutate(data.quote)}
          className={`${ui.btnPrimary} ${skin.dealerInkBtn} w-full tabular-nums`}
        >
          {placing ? 'Đang đặt…' : `Ghi công nợ ${formatVnd(data.total)}`}
        </button>
        <button
          type="button"
          disabled={placing}
          className={`${ui.btnText} w-full no-underline`}
          onClick={() =>
            onEditInCart({
              code: data.orderCodes[0] ?? '',
              label: `đơn tháng ${data.month}`,
              lines: data.lines.map((l) => ({ variationId: l.variationId, quantity: l.quantity, name: l.name })),
              skipped: data.skipped,
            })
          }
        >
          Sửa trong giỏ
        </button>
      </div>
    ) : undefined;

  return (
    <Sheet open={open} onClose={onClose} title={title} dismissible={!placing} footer={footer}>
      {loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      ) : q.isError && !data ? (
        <ErrorState message={errText(q.error)} onRetry={() => void refetch()} />
      ) : data ? (
        <div className="text-sm">
          {data.orderCodes.length > 0 && (
            <p className="text-xs text-stone-600">
              Gộp {data.orderCodes.length} đơn đã nhận ({data.orderCodes.map((c) => `#${c}`).join(', ')}), tính theo giá hôm nay.
            </p>
          )}
          {data.skipped.length > 0 && (
            <p role="alert" className="mt-2 text-xs text-danger-fg">
              Bỏ {data.skipped.length} mặt hàng không còn bán sỉ: {data.skipped.join(', ')}.
            </p>
          )}
          {data.lines.length > 0 && (
            <ul aria-label="Mặt hàng đặt lại" className="mt-2 divide-y divide-stone-200">
              {data.lines.map((l) => {
                const preorder = l.quantity - Math.max(0, l.stock);
                return (
                  <li key={l.variationId} className="flex items-start justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className="line-clamp-2 text-stone-900">{l.name}</div>
                      <div className="text-xs tabular-nums text-stone-600">
                        {l.quantity} × {formatVnd(l.unitPrice)}
                        {preorder > 0 ? ` · đặt trước ${preorder}` : ''}
                      </div>
                    </div>
                    <span className="flex-none font-semibold tabular-nums text-stone-900">{formatVnd(l.lineTotal)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {data.lines.length > 0 && (
            <dl className="mt-2 flex flex-col gap-1 border-t border-stone-200 pt-2">
              <Row label="Tiền hàng" value={formatVnd(data.goodsTotal)} />
              <Row label="Phí giao" value={data.shippingFee > 0 ? formatVnd(data.shippingFee) : 'Miễn phí'} />
              <Row label="Tổng" value={formatVnd(data.total)} strong />
            </dl>
          )}
          <section aria-label="Hạn mức công nợ" className={`mt-3 p-3 ${skin.card}`}>
            <dl className="flex flex-col gap-1">
              <Row label="Hạn mức còn lại" value={formatVnd(data.credit.available)} />
              {data.lines.length > 0 && <Row label="Sau đơn này" value={creditAfterText(data.credit.after, formatVnd)} danger={data.credit.after < 0} strong />}
            </dl>
          </section>
          {(blockMessage || error) && (
            <p role="alert" className="mt-2 text-danger-fg">
              {error ?? blockMessage}
            </p>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}
