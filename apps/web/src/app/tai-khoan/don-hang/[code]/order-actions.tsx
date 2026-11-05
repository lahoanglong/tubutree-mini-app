'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { OrderActionKind, OrderActionPlan } from '@tubutree/app-core/commerce/order-tracking';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelOrder,
  fetchMyRefunds,
  fetchMyReturns,
  formatVnd,
  type OrderDetailDTO,
  type ReturnRequestDTO,
} from '@/lib/shop-client';
import { bankPaymentHref } from '@/lib/order-view';
import { reviewHref } from '@/lib/reviews-client';
import { openProductSlug } from '@tubutree/app-core/api/orders';
import { ui } from '@/lib/guest-ui';
import { mini } from '@/components/order-mobile/mobile-ui';
import { OrderActionBar } from '@/components/orders/order-action-bar';
import { BottomSheet } from '@/components/mini/bottom-sheet';
import { SupportContact } from '@/components/support-contact';
import { Sheet } from '@/components/ui/sheet';
import { MD_DOWN, useMediaQuery } from '@/lib/use-media-query';
import { invalidateBalances } from '@/lib/balances';
import {
  EMPTY_BANK,
  bankDetailsError,
  cancelRefundMode,
  destinationBody,
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

const CANCEL_TITLE = 'Bạn muốn huỷ đơn này?';
const CANCEL_NOTE = 'Đơn đã huỷ không thể khôi phục lại.';

/**
 * Việc khách tự làm được trên đơn, theo kế hoạch nút của app-core (`orderActionPlan`): một nút chính theo trạng thái, phần còn lại
 * vào "Thêm thao tác"; hủy (khi còn kịp, đơn đã trả tiền thì chọn nơi nhận tiền hoàn), mua lại, đánh giá, đổi/trả theo dòng và số lượng.
 * Kế hoạch chỉ quyết định việc BÀY nút nào; BE vẫn kiểm lại và lời từ chối của BE (quá hạn đổi/trả, đã có yêu cầu…) hiện nguyên văn.
 */
export function OrderActions({
  order: o,
  plan,
  note = null,
}: {
  order: OrderDetailDTO;
  plan: OrderActionPlan;
  /** Dòng nhỏ trên nút chính: "Còn 2 giờ 05 phút để thanh toán". */
  note?: string | null;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const isPhone = useMediaQuery(MD_DOWN);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnKey, setReturnKey] = useState(0);
  const [returnSent, setReturnSent] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  // State ổn định (không dựng target trong JSX): ReorderSheet khởi tạo lại lựa chọn theo danh tính của target.
  const [reorderTarget, setReorderTarget] = useState<ReorderTarget | null>(null);
  const [cancelMethod, setCancelMethod] = useState<RefundMethodChoice>('WALLET');
  const [cancelBank, setCancelBank] = useState<RefundBankInput>(EMPTY_BANK);
  const [cancelTouched, setCancelTouched] = useState(false);
  const [cancelReason, setCancelReason] = useState<CancelReasonCode | null>(null);
  const [cancelReasonText, setCancelReasonText] = useState('');
  const keepOrderRef = useRef<HTMLButtonElement>(null);
  const cancelNoticeRef = useRef<HTMLParagraphElement>(null);
  const barFocusRef = useRef<(() => void) | null>(null);
  const restoreFocus = useRef(false);

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
    if (barFocusRef.current && !cancel.isSuccess) barFocusRef.current();
    else cancelNoticeRef.current?.focus();
  }, [confirmCancel, cancel.isPending, cancel.isSuccess, cancel.isError]);

  // Đã huỷ xong thì ẩn nút huỷ của kế hoạch cũ tới khi đơn tải lại; đang mở/đã gửi form đổi/trả thì ẩn nút đổi/trả.
  const hide = (k: OrderActionKind) => (k === 'cancel' && cancel.isSuccess) || (k === 'return' && (returnOpen || returnSent));
  const more = plan.more.filter((k) => !hide(k));
  const primary = plan.primary && hide(plan.primary) ? (more.shift() ?? null) : plan.primary;
  const shownPlan: OrderActionPlan = { ...plan, primary, more };
  // Lời từ chối hủy của BE và kết quả hủy phải còn trên màn dù đơn tải lại không còn việc gì để bấm.
  if (!primary && !showsReturns && !cancel.isError && !cancel.isSuccess) return null;
  const returnMore = orderReturns.some((r) => r.status === 'APPROVED');
  const onAction = (kind: OrderActionKind) => {
    if (kind === 'pay') {
      // Từ md khung QR nằm ngay trong trang: cuộn tới nó thay vì rời trang.
      const panel = isPhone ? null : document.getElementById('order-pay-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else router.push(bankPaymentHref(o.code));
    }
    else if (kind === 'cancel') {
      if (cancel.isPending) return;
      cancel.reset();
      setConfirmCancel(true);
    } else if (kind === 'contact') setContactOpen(true);
    else if (kind === 'reorder') setReorderTarget(orderReorderTarget({ code: o.code, items: o.items as OrderItemView[] }));
    else if (kind === 'return') {
      setReturnKey((k) => k + 1);
      setReturnOpen(true);
    } else {
      const item = o.items.find((it) => it.id === plan.reviewItemId);
      const slug = item ? openProductSlug(item) : null;
      if (slug) router.push(reviewHref(slug, o.id));
    }
  };
  const cancelFields = (
    <>
      <CancelReasonPicker
        code={cancelReason}
        onCode={setCancelReason}
        text={cancelReasonText}
        onText={setCancelReasonText}
        showError={cancelTouched}
      />
      {refundMode === 'choose' && (
        <div className={isPhone ? 'mt-3' : 'mt-3 rounded-control bg-stone-0 p-3'}>
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
    </>
  );
  const keepButton = (
    <button ref={keepOrderRef} type="button" onClick={() => setConfirmCancel(false)} disabled={cancel.isPending} className={ui.btnPrimary}>
      Giữ đơn
    </button>
  );
  const confirmButton = (
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
  );
  return (
    <section aria-label="Thao tác với đơn hàng" className={`mt-4 rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card max-md:mt-2 max-md:py-0 lg:mt-0 ${mini.band}`}>
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

      {confirmCancel && !isPhone ? (
        <div
          role="alertdialog"
          aria-labelledby="cancel-title"
          aria-describedby={refundMode === 'wallet' || refundMode === 'unpaidTransfer' ? 'cancel-note cancel-refund' : 'cancel-note'}
          className="rounded-control border border-danger-fg bg-danger-bg p-3"
        >
          <p id="cancel-title" className="font-semibold text-stone-900">
            {CANCEL_TITLE}
          </p>
          <p id="cancel-note" className="mt-1 text-sm text-stone-700">
            {CANCEL_NOTE}
          </p>
          {cancelFields}
          <div className="mt-3 flex flex-wrap gap-2">
            {keepButton}
            {confirmButton}
          </div>
        </div>
      ) : (
        shownPlan.primary && <OrderActionBar plan={shownPlan} returnMore={returnMore} note={note} busy={cancel.isPending} onAction={onAction} focusRef={barFocusRef} />
      )}

      {isPhone && (
        <Sheet
          open={confirmCancel}
          onClose={() => setConfirmCancel(false)}
          title={CANCEL_TITLE}
          role="alertdialog"
          dismissible={!cancel.isPending}
          describedBy={refundMode === 'wallet' || refundMode === 'unpaidTransfer' ? 'cancel-note cancel-refund' : 'cancel-note'}
          footer={
            <div className="flex flex-col gap-2">
              {keepButton}
              {confirmButton}
            </div>
          }
        >
          <p id="cancel-note" className="text-sm text-stone-600">
            {CANCEL_NOTE}
          </p>
          {cancelFields}
        </Sheet>
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
      <BottomSheet open={contactOpen} onClose={() => setContactOpen(false)} title={fillCopy('order.action.contact')}>
        <SupportContact orderCode={o.code} />
      </BottomSheet>
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
