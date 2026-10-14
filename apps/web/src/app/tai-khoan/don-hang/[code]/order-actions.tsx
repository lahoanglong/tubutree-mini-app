'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Clock, RotateCcw, XCircle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelOrder,
  fetchMyReturns,
  formatVnd,
  repurchaseOrder,
  type OrderDetailDTO,
  type RepurchaseResult,
  type ReturnRequestDTO,
} from '@/lib/shop-client';
import { canCancelOrder, isReorderable } from '@/lib/order-view';
import { ui } from '@/lib/guest-ui';
import { invalidateBalances } from '@/lib/balances';
import {
  EMPTY_BANK,
  bankDetailsError,
  cancelRefundMode,
  destinationBody,
  remainingByLine,
  returnLinesText,
  returnStatusLabel,
  type RefundBankInput,
  type RefundMethodChoice,
} from '@/lib/refund-rules';
import { RefundDestinationPicker } from './refund-destination-picker';
import { ReturnRequestForm } from './return-request-form';

/** Số dòng của lượt mua lại không thêm được (hết hàng/ngừng bán) hoặc chỉ thêm được một phần. */
function repurchaseSummary(r: RepurchaseResult): { added: number; short: number } {
  const added = r.results.filter((x) => x.addedQuantity > 0).length;
  return { added, short: r.results.filter((x) => x.status !== 'added').length };
}

/**
 * Việc khách tự làm được trên đơn: hủy (khi còn kịp, đơn đã trả tiền thì chọn nơi nhận tiền hoàn), mua lại (đơn đã kết thúc),
 * yêu cầu đổi/trả theo dòng và số lượng (đơn đã giao).
 * Quy tắc chỉ quyết định việc BÀY nút nào; BE vẫn kiểm lại và lời từ chối của BE (quá hạn đổi/trả, đã có yêu cầu…) hiện nguyên văn.
 */
export function OrderActions({
  order: o,
  userId,
  supportEmail,
}: {
  order: OrderDetailDTO;
  userId: string | null | undefined;
  supportEmail: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnKey, setReturnKey] = useState(0);
  const [returnSent, setReturnSent] = useState(false);
  const [partial, setPartial] = useState<{ added: number; short: number } | null>(null);
  const [cancelMethod, setCancelMethod] = useState<RefundMethodChoice>('WALLET');
  const [cancelBank, setCancelBank] = useState<RefundBankInput>(EMPTY_BANK);
  const [cancelTouched, setCancelTouched] = useState(false);

  const canCancel = canCancelOrder(o, userId);
  const canReorder = isReorderable(o.status);
  const delivered = o.status === 'DELIVERED';
  const showsReturns = delivered || o.status === 'RETURNED';
  const refundMode = cancelRefundMode({ paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus ?? 'UNPAID' });
  const cancelBankError = refundMode === 'choose' && cancelMethod === 'BANK' ? bankDetailsError(cancelBank) : null;

  const returnsQ = useQuery({ queryKey: ['my-returns'], queryFn: fetchMyReturns, enabled: showsReturns, retry: 0 });
  const orderReturns: ReturnRequestDTO[] = o.id ? (returnsQ.data ?? []).filter((r) => r.orderId === o.id) : [];
  const remaining = remainingByLine(
    o.items.filter((it): it is typeof it & { id: string } => !!it.id),
    orderReturns,
  );
  const canRequestMore =
    delivered && !orderReturns.some((r) => r.status === 'REQUESTED') && [...remaining.values()].some((q) => q > 0);

  const cancel = useMutation({
    mutationFn: (choose: boolean) => cancelOrder(o.code, choose ? destinationBody(cancelMethod, cancelBank) : undefined),
    onSuccess: () => {
      setConfirmCancel(false);
      void qc.invalidateQueries({ queryKey: ['order', o.code] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['my-refunds'] });
      invalidateBalances(qc);
    },
    onError: () => setConfirmCancel(false),
  });

  const repurchase = useMutation({
    mutationFn: () => repurchaseOrder(o.code),
    onSuccess: (res) => {
      qc.setQueryData(['cart'], res.cart);
      const summary = repurchaseSummary(res);
      if (summary.added > 0 && summary.short === 0) router.push('/gio-hang');
      else setPartial(summary);
    },
  });

  const nothingToDo = !canCancel && !canReorder && !showsReturns;
  if (nothingToDo) return null;

  return (
    <section aria-label="Thao tác với đơn hàng" className="mt-4 rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      {cancel.isSuccess && (
        <p role="status" className="mb-3 text-sm font-medium text-success-fg">
          Đã hủy đơn hàng. Hàng, điểm và tiền đã dùng cho đơn này được hoàn lại theo quy định.
        </p>
      )}
      {cancel.isError && (
        <p role="alert" className={`mb-3 ${ui.error}`}>
          {cancel.error instanceof Error ? cancel.error.message : 'Không hủy được đơn hàng.'}
        </p>
      )}

      {confirmCancel ? (
        <div role="alertdialog" aria-labelledby="cancel-title" className="rounded-control border border-danger-fg bg-danger-bg p-3">
          <p id="cancel-title" className="font-semibold text-stone-900">
            Bạn muốn hủy đơn này?
          </p>
          <p className="mt-1 text-sm text-stone-700">Đơn đã hủy không thể khôi phục lại.</p>
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
            <p className="mt-2 text-sm text-stone-700">{`${formatVnd(o.total)} được hoàn ngay vào Ví Tubu.`}</p>
          )}
          {refundMode === 'unpaidTransfer' && (
            <p role="note" className="mt-2 rounded-control border border-warning-fg bg-warning-bg p-3 text-sm text-warning-fg">
              Nếu bạn vừa chuyển khoản, Tubu có thể cần vài phút để ghi nhận — hãy chờ thêm thay vì huỷ. Tiền về sau khi huỷ vẫn được
              hoàn: bạn chọn nhận về Ví Tubu hoặc tài khoản ngân hàng ở chi tiết đơn.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setConfirmCancel(false)} disabled={cancel.isPending} className={ui.btnPrimary}>
              Giữ đơn
            </button>
            <button
              type="button"
              onClick={() => {
                setCancelTouched(true);
                if (!cancelBankError) cancel.mutate(refundMode === 'choose');
              }}
              disabled={cancel.isPending}
              className={`${ui.btnSecondary} border-danger-fg text-danger-fg`}
            >
              {cancel.isPending ? 'Đang hủy…' : 'Hủy đơn'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {canCancel && !cancel.isSuccess && (
            <button
              type="button"
              onClick={() => {
                cancel.reset();
                setConfirmCancel(true);
              }}
              className={`${ui.btnSecondary} border-danger-fg text-danger-fg`}
            >
              Hủy đơn
            </button>
          )}
          {canReorder && (
            <button type="button" onClick={() => repurchase.mutate()} disabled={repurchase.isPending} className={ui.btnPrimary}>
              {repurchase.isPending ? 'Đang thêm vào giỏ…' : 'Mua lại đơn này'}
            </button>
          )}
          {canRequestMore && !returnOpen && !returnSent && (
            <button
              type="button"
              onClick={() => {
                setReturnKey((k) => k + 1);
                setReturnOpen(true);
              }}
              className={`${ui.btnSecondary} gap-2`}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {orderReturns.some((r) => r.status === 'APPROVED') ? 'Trả thêm sản phẩm' : 'Yêu cầu đổi/trả'}
            </button>
          )}
        </div>
      )}

      {repurchase.isError && (
        <p role="alert" className={`mt-3 ${ui.error}`}>
          {repurchase.error instanceof Error ? repurchase.error.message : 'Không thêm được vào giỏ.'}
        </p>
      )}
      {partial && (
        <div role="status" className="mt-3 rounded-control border border-warning-fg bg-warning-bg p-3 text-sm text-warning-fg">
          {partial.added > 0 ? (
            <p>
              Đã thêm {partial.added} sản phẩm vào giỏ. {partial.short} sản phẩm đã hết hàng, ngừng bán hoặc chỉ còn một phần nên chưa thêm đủ.
            </p>
          ) : (
            <p>Các sản phẩm trong đơn này hiện đã hết hàng hoặc ngừng bán nên chưa thêm được vào giỏ.</p>
          )}
          {partial.added > 0 && (
            <Link href="/gio-hang" className="mt-1 inline-flex min-h-11 items-center font-semibold underline">
              Xem giỏ hàng
            </Link>
          )}
        </div>
      )}

      {showsReturns && orderReturns.map((r) => <ReturnStatus key={r.id} request={r} items={o.items} />)}
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
          supportEmail={supportEmail}
          onClose={() => setReturnOpen(false)}
          onDone={() => {
            setReturnOpen(false);
            setReturnSent(true);
          }}
        />
      )}
    </section>
  );
}

function ReturnStatus({ request: r, items }: { request: ReturnRequestDTO; items: OrderDetailDTO['items'] }) {
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
        <span className="min-w-0 break-words">{returnStatusLabel(r)}</span>
      </p>
      {lines && <p className="ml-6 text-xs text-stone-600">Trả: {lines}</p>}
      {r.status === 'APPROVED' && !!r.items?.length && (
        <p className="ml-6 text-xs text-stone-600">{r.receivedAt ? 'Tubu đã nhận lại hàng.' : 'Tubu sẽ liên hệ để nhận lại hàng.'}</p>
      )}
    </div>
  );
}
