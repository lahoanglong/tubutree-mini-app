'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, RotateCcw, XCircle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelOrder,
  fetchMyRefunds,
  fetchMyReturns,
  formatVnd,
  getPublicConfig,
  type OrderDetailDTO,
  type ReturnRequestDTO,
} from '@/lib/shop-client';
import { canCancelOrder, isReorderable, returnWindowState } from '@/lib/order-view';
import { ui } from '@/lib/guest-ui';
import { mini } from '@/components/order-mobile/mobile-ui';
import { invalidateBalances } from '@/lib/balances';
import {
  EMPTY_BANK,
  bankDetailsError,
  cancelRefundMode,
  destinationBody,
  remainingByLine,
  refundOfReturn,
  refundStatusText,
  returnLinesText,
  returnStatusLabel,
  type MyRefund,
  type RefundBankInput,
  type RefundMethodChoice,
} from '@/lib/refund-rules';
import type { OrderItemView } from '@tubutree/app-core/api/orders';
import { ReorderSheet } from '@/components/reorder/reorder-sheet';
import { orderReorderTarget, type ReorderTarget } from '@/components/reorder/reorder-types';
import { RefundDestinationPicker } from './refund-destination-picker';
import { RefundDestinationControl } from './order-refunds';
import { ReturnRequestForm } from './return-request-form';
import { CancelReasonPicker } from './cancel-reason-picker';
import { cancelReasonBody, type CancelReasonCode } from '@tubutree/app-core/cancel-reasons';
import { actionErrorText } from '@/lib/error-text';

/**
 * Việc khách tự làm được trên đơn: hủy (khi còn kịp, đơn đã trả tiền thì chọn nơi nhận tiền hoàn), mua lại (đơn đã kết thúc),
 * yêu cầu đổi/trả theo dòng và số lượng (đơn đã giao).
 * Quy tắc chỉ quyết định việc BÀY nút nào; BE vẫn kiểm lại và lời từ chối của BE (quá hạn đổi/trả, đã có yêu cầu…) hiện nguyên văn.
 */
export function OrderActions({ order: o, userId }: { order: OrderDetailDTO; userId: string | null | undefined }) {
  const qc = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnKey, setReturnKey] = useState(0);
  const [returnSent, setReturnSent] = useState(false);
  // State ổn định (không dựng target trong JSX): ReorderSheet khởi tạo lại lựa chọn theo danh tính của target.
  const [reorderTarget, setReorderTarget] = useState<ReorderTarget | null>(null);
  const [cancelMethod, setCancelMethod] = useState<RefundMethodChoice>('WALLET');
  const [cancelBank, setCancelBank] = useState<RefundBankInput>(EMPTY_BANK);
  const [cancelTouched, setCancelTouched] = useState(false);
  const [cancelReason, setCancelReason] = useState<CancelReasonCode | null>(null);
  const [cancelReasonText, setCancelReasonText] = useState('');
  const cancelTriggerRef = useRef<HTMLButtonElement>(null);
  const keepOrderRef = useRef<HTMLButtonElement>(null);
  const cancelNoticeRef = useRef<HTMLParagraphElement>(null);
  const restoreFocus = useRef(false);

  const canCancel = canCancelOrder(o, userId);
  const canReorder = isReorderable(o.status);
  const delivered = o.status === 'DELIVERED';
  const showsReturns = delivered || o.status === 'RETURNED';
  const refundMode = cancelRefundMode({ paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus ?? 'UNPAID' });
  const cancelBankError = refundMode === 'choose' && cancelMethod === 'BANK' ? bankDetailsError(cancelBank) : null;

  const returnsQ = useQuery({ queryKey: ['my-returns'], queryFn: fetchMyReturns, enabled: showsReturns, retry: 0 });
  const orderReturns: ReturnRequestDTO[] = o.id ? (returnsQ.data ?? []).filter((r) => r.orderId === o.id) : [];
  // Cùng khoá với khối Hoàn tiền (OrderRefunds): thẻ đổi/trả nói nơi nhận theo khoản hoàn thật (khách có thể đã đổi sang Ví).
  const refundsQ = useQuery({
    queryKey: ['my-refunds', o.id],
    queryFn: () => fetchMyRefunds(o.id!),
    enabled: !!o.id && orderReturns.some((r) => r.status === 'APPROVED'),
    retry: 0,
  });
  const remaining = remainingByLine(
    o.items.filter((it): it is typeof it & { id: string } => !!it.id),
    orderReturns,
  );
  const configQ = useQuery({ queryKey: ['public-config'], queryFn: getPublicConfig, staleTime: 5 * 60_000, enabled: delivered, retry: 0 });
  const returnDays = configQ.data?.returnWindowDays ?? 7;
  const returnWindow = returnWindowState(o, returnDays);
  const canRequestMore =
    delivered && !orderReturns.some((r) => r.status === 'REQUESTED') && [...remaining.values()].some((q) => q > 0);

  const cancel = useMutation({
    mutationFn: ({ choose, reason }: { choose: boolean; reason: CancelReasonCode }) =>
      cancelOrder(o.code, choose ? destinationBody(cancelMethod, cancelBank) : undefined, cancelReasonBody(reason, cancelReasonText)),
    onSuccess: () => {
      setConfirmCancel(false);
      void qc.invalidateQueries({ queryKey: ['order', o.code] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['my-refunds'] });
      invalidateBalances(qc);
    },
    onError: () => {
      setConfirmCancel(false);
      // BE từ chối vì đơn vừa bàn giao vận chuyển (và đã đồng bộ trạng thái mới): tải lại để ẩn nút hủy.
      void qc.invalidateQueries({ queryKey: ['order', o.code] });
    },
  });

  // Hộp xác nhận hủy thay chính nút "Hủy đơn" nên focus phải được dời theo: vào "Giữ đơn" (lựa chọn an toàn) khi mở, và khi đóng
  // về nút "Hủy đơn" (hoặc về dòng kết quả khi nút đã ẩn vì hủy xong). Chờ hết `isPending` vì kết quả hủy đến sau lúc hộp đóng.
  useEffect(() => {
    if (!confirmCancel) return;
    restoreFocus.current = true;
    keepOrderRef.current?.focus();
  }, [confirmCancel]);
  useEffect(() => {
    if (confirmCancel || cancel.isPending || !restoreFocus.current) return;
    restoreFocus.current = false;
    (cancelTriggerRef.current ?? cancelNoticeRef.current)?.focus();
  }, [confirmCancel, cancel.isPending, cancel.isSuccess, cancel.isError]);

  const showsReturnButton = canRequestMore && returnWindow.open && !returnOpen && !returnSent;
  const hasButtons = (canCancel && !cancel.isSuccess) || canReorder || showsReturnButton;
  // Lời từ chối hủy của BE phải còn trên màn dù đơn tải lại không còn việc gì để bấm.
  const nothingToDo = !canCancel && !canReorder && !showsReturns && !cancel.isError;
  if (nothingToDo) return null;

  return (
    <section aria-label="Thao tác với đơn hàng" className={`mt-4 rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card max-md:mt-2 max-md:py-0 ${mini.band}`}>
      {cancel.isSuccess && (
        <p ref={cancelNoticeRef} tabIndex={-1} role="status" className="mb-3 text-sm font-medium text-success-fg outline-none">
          Đã huỷ đơn hàng. Hàng, điểm và tiền đã dùng cho đơn này được hoàn lại theo quy định.
        </p>
      )}
      {cancel.isError && (
        <p ref={cancelNoticeRef} tabIndex={-1} role="alert" className={`mb-3 outline-none ${ui.error}`}>
          {actionErrorText(cancel.error)}
        </p>
      )}

      {confirmCancel ? (
        <div
          role="alertdialog"
          aria-labelledby="cancel-title"
          aria-describedby={refundMode === 'wallet' || refundMode === 'unpaidTransfer' ? 'cancel-note cancel-refund' : 'cancel-note'}
          className="rounded-control border border-danger-fg bg-danger-bg p-3"
        >
          <p id="cancel-title" className="font-semibold text-stone-900">
            Bạn muốn huỷ đơn này?
          </p>
          <p id="cancel-note" className="mt-1 text-sm text-stone-700">
            Đơn đã huỷ không thể khôi phục lại.
          </p>
          <CancelReasonPicker
            code={cancelReason}
            onCode={setCancelReason}
            text={cancelReasonText}
            onText={setCancelReasonText}
            showError={cancelTouched}
          />
          {refundMode === 'choose' && (
            <div className="mt-3 rounded-control bg-stone-0 p-3">
              <RefundDestinationPicker
                method={cancelMethod}
                onMethod={setCancelMethod}
                bank={cancelBank}
                onBank={setCancelBank}
                bankError={cancelTouched ? cancelBankError : null}
                amountLabel={formatVnd(o.total)}
              />
            </div>
          )}
          {refundMode === 'wallet' && (
            <p id="cancel-refund" className="mt-2 text-sm text-stone-700">{`${formatVnd(o.total)} được hoàn ngay vào Ví Tubu.`}</p>
          )}
          {refundMode === 'unpaidTransfer' && (
            <p id="cancel-refund" role="note" className="mt-2 rounded-control border border-warning-fg bg-warning-bg p-3 text-sm text-warning-fg">
              Nếu bạn vừa chuyển khoản, Tubu có thể cần vài phút để ghi nhận — hãy chờ thêm thay vì huỷ. Tiền về sau khi huỷ vẫn được
              hoàn: bạn chọn nhận về Ví Tubu hoặc tài khoản ngân hàng ở chi tiết đơn.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button ref={keepOrderRef} type="button" onClick={() => setConfirmCancel(false)} disabled={cancel.isPending} className={ui.btnPrimary}>
              Giữ đơn
            </button>
            <button
              type="button"
              onClick={() => {
                setCancelTouched(true);
                if (cancelReason && !cancelBankError) cancel.mutate({ choose: refundMode === 'choose', reason: cancelReason });
              }}
              disabled={cancel.isPending}
              className={`${ui.btnSecondary} border-danger-fg text-danger-fg`}
            >
              {cancel.isPending ? 'Đang huỷ…' : 'Huỷ đơn'}
            </button>
          </div>
        </div>
      ) : (
        hasButtons && (
        <ActionRow>
          {canCancel && !cancel.isSuccess && (
            <button
              ref={cancelTriggerRef}
              type="button"
              onClick={() => {
                cancel.reset();
                setConfirmCancel(true);
              }}
              className={`${ui.btnSecondary} border-danger-fg text-danger-fg max-md:flex-1`}
            >
              Huỷ đơn
            </button>
          )}
          {canReorder && (
            <button type="button" onClick={() => setReorderTarget(orderReorderTarget({ code: o.code, items: o.items as OrderItemView[] }))} className={`${ui.btnPrimary} max-md:flex-1`}>
              Mua lại đơn này
            </button>
          )}
          {showsReturnButton && (
            <button
              type="button"
              onClick={() => {
                setReturnKey((k) => k + 1);
                setReturnOpen(true);
              }}
              className={`${ui.btnSecondary} gap-2 max-md:flex-1`}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {orderReturns.some((r) => r.status === 'APPROVED') ? 'Trả thêm sản phẩm' : 'Yêu cầu đổi/trả'}
            </button>
          )}
        </ActionRow>
        )
      )}

      {canRequestMore && !returnWindow.open && (
        <p className="mt-3 rounded-control bg-stone-50 p-3 text-xs text-stone-700">
          {`Đã quá hạn đổi/trả (${returnDays} ngày kể từ khi nhận hàng). Cần hỗ trợ thêm, vui lòng liên hệ Tubu bên dưới.`}
        </p>
      )}

      {showsReturns && orderReturns.map((r) => (
          <ReturnStatus key={r.id} request={r} items={o.items} refund={refundOfReturn(refundsQ.data, r.id)} placedForCustomer={!!o.placedForCustomer} />
        ))}
      {returnSent && (
        <p role="status" className="mt-3 text-sm font-medium text-success-fg">
          Đã gửi yêu cầu đổi/trả. Tubu sẽ phản hồi trong 24 giờ.
        </p>
      )}

      {delivered && returnOpen && (
        <ReturnRequestForm
          key={returnKey}
          order={o}
          returns={orderReturns}
          onClose={() => setReturnOpen(false)}
          onDone={() => {
            setReturnOpen(false);
            setReturnSent(true);
          }}
        />
      )}
      <ReorderSheet target={reorderTarget} navigateToCart onClose={() => setReorderTarget(null)} />
    </section>
  );
}

function ReturnStatus({
  request: r,
  items,
  refund,
  placedForCustomer,
}: {
  request: ReturnRequestDTO;
  items: OrderDetailDTO['items'];
  refund?: MyRefund;
  placedForCustomer: boolean;
}) {
  const view =
    r.status === 'APPROVED'
      ? { Icon: CheckCircle2, tone: 'text-success-fg' }
      : r.status === 'REJECTED'
        ? { Icon: XCircle, tone: 'text-danger-fg' }
        : { Icon: Clock, tone: 'text-stone-700' };
  const lines = returnLinesText(
    r,
    items.filter((it): it is typeof it & { id: string } => !!it.id),
  );
  return (
    <div role="status" className="mt-3 text-sm">
      <p className={`flex items-start gap-2 ${view.tone}`}>
        <view.Icon className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
        <span className="min-w-0 break-words">{returnStatusLabel(r, refund, placedForCustomer)}</span>
      </p>
      {lines && <p className="ml-6 text-xs text-stone-600">Trả: {lines}</p>}
      {r.status === 'APPROVED' && !!r.items?.length && (
        <p className="ml-6 text-xs text-stone-600">{r.receivedAt ? 'Tubu đã nhận lại hàng.' : 'Tubu sẽ liên hệ để nhận lại hàng.'}</p>
      )}
      {refund && !placedForCustomer && (
        <div className="ml-6">
          {refundStatusText(refund).detail && <p className="text-xs text-stone-600">{refundStatusText(refund).detail}</p>}
          <RefundDestinationControl refund={refund} />
        </div>
      )}
    </div>
  );
}

/**
 * Hàng nút thao tác: từ md nằm trong thẻ như cũ; ở điện thoại dính đáy toàn chiều ngang như StickyActionBar của Mini App
 * (Hủy đơn / Mua lại đơn này / Yêu cầu đổi trả). Thanh fixed che đáy trang nên báo qua `has-sticky-bar` + `--sticky-bar-h`
 * để body chừa chỗ và thanh tab ẩn đi, cùng cách StickyActionBar của web làm.
 */
function ActionRow({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const bar = ref.current;
    const measure = () => {
      const fixed = bar && getComputedStyle(bar).position === 'fixed';
      document.body.classList.toggle('has-sticky-bar', !!fixed);
      if (fixed) root.style.setProperty('--sticky-bar-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
      else root.style.removeProperty('--sticky-bar-h');
    };
    measure();
    window.addEventListener('resize', measure);
    // Số nút đổi (hủy xong, mua lại hiện ra) làm thanh cao thấp khác đi mà không có resize.
    const observer = typeof ResizeObserver === 'undefined' || !bar ? null : new ResizeObserver(measure);
    if (bar) observer?.observe(bar);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty('--sticky-bar-h');
      document.body.classList.remove('has-sticky-bar');
    };
  }, []);
  return (
    <div
      ref={ref}
      data-testid="order-action-bar"
      data-sticky-bar
      className="flex flex-wrap gap-2 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:flex-nowrap max-md:border-t max-md:border-stone-200 max-md:bg-stone-0 max-md:px-4 max-md:pt-3 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] max-md:shadow-raised"
    >
      {children}
    </div>
  );
}
