'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Clock, RotateCcw, XCircle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelOrder,
  fetchMyReturns,
  repurchaseOrder,
  requestReturn,
  type OrderDetailDTO,
  type RepurchaseResult,
  type ReturnRequestDTO,
} from '@/lib/shop-client';
import { canCancelOrder, isReorderable } from '@/lib/order-view';
import { ui } from '@/lib/guest-ui';

const RETURN_REASON_MIN = 5;
const RETURN_REASON_MAX = 500;

/** Số dòng của lượt mua lại không thêm được (hết hàng/ngừng bán) hoặc chỉ thêm được một phần. */
function repurchaseSummary(r: RepurchaseResult): { added: number; short: number } {
  const added = r.results.filter((x) => x.addedQuantity > 0).length;
  return { added, short: r.results.filter((x) => x.status !== 'added').length };
}

/**
 * Việc khách tự làm được trên đơn: hủy (khi còn kịp), mua lại (đơn đã kết thúc), yêu cầu đổi/trả (đơn đã giao).
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
  const [reason, setReason] = useState('');
  const [partial, setPartial] = useState<{ added: number; short: number } | null>(null);

  const canCancel = canCancelOrder(o, userId);
  const canReorder = isReorderable(o.status);
  const delivered = o.status === 'DELIVERED';

  const returnsQ = useQuery({ queryKey: ['my-returns'], queryFn: fetchMyReturns, enabled: delivered, retry: 0 });
  const existingReturn: ReturnRequestDTO | undefined = o.id ? returnsQ.data?.find((r) => r.orderId === o.id) : undefined;

  const cancel = useMutation({
    mutationFn: () => cancelOrder(o.code),
    onSuccess: () => {
      setConfirmCancel(false);
      void qc.invalidateQueries({ queryKey: ['order', o.code] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
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

  const returnReq = useMutation({
    mutationFn: () => requestReturn(o.code, reason.trim()),
    onSuccess: () => {
      setReturnOpen(false);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['my-returns'] });
    },
  });
  const reasonOk = reason.trim().length >= RETURN_REASON_MIN;

  const nothingToDo = !canCancel && !canReorder && !delivered;
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
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setConfirmCancel(false)} disabled={cancel.isPending} className={ui.btnPrimary}>
              Giữ đơn
            </button>
            <button
              type="button"
              onClick={() => cancel.mutate()}
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
          {delivered && !existingReturn && !returnOpen && !returnReq.isSuccess && (
            <button type="button" onClick={() => setReturnOpen(true)} className={`${ui.btnSecondary} gap-2`}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Yêu cầu đổi/trả
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

      {delivered && existingReturn && <ReturnStatus request={existingReturn} />}
      {delivered && returnReq.isSuccess && !existingReturn && (
        <p role="status" className="mt-3 text-sm font-medium text-success-fg">
          Đã gửi yêu cầu đổi/trả. Tubu sẽ phản hồi trong 24 giờ.
        </p>
      )}

      {delivered && returnOpen && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (reasonOk) returnReq.mutate();
          }}
        >
          <h3 className="font-semibold text-stone-900">Yêu cầu đổi/trả</h3>
          <p className="text-xs text-stone-600">
            Chỉ áp dụng khi lỗi nhà sản xuất (hỏng bao bì, sai hạn dùng, sai mã, không đúng mô tả) và trong thời hạn đổi/trả kể
            từ khi nhận hàng. Cần gửi ảnh minh chứng? Gửi kèm mã đơn {o.code} qua email {supportEmail}.
          </p>
          <label className="block">
            <span className="text-xs font-medium text-stone-700">Lý do đổi/trả</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={RETURN_REASON_MAX}
              rows={4}
              aria-invalid={reason.length > 0 && !reasonOk ? true : undefined}
              aria-describedby="return-reason-hint"
              className={`${reason.length > 0 && !reasonOk ? ui.fieldError : ui.field} mt-1 py-2`}
            />
          </label>
          <p id="return-reason-hint" className={`text-xs ${reason.length > 0 && !reasonOk ? 'text-danger-fg' : 'text-stone-600'}`}>
            {reason.length > 0 && !reasonOk
              ? `Hãy mô tả ít nhất ${RETURN_REASON_MIN} ký tự.`
              : `${reason.length}/${RETURN_REASON_MAX} ký tự`}
          </p>
          {returnReq.isError && (
            <p role="alert" className={ui.error}>
              {returnReq.error instanceof Error ? returnReq.error.message : 'Không gửi được yêu cầu.'}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setReturnOpen(false);
                returnReq.reset();
              }}
              disabled={returnReq.isPending}
              className={ui.btnSecondary}
            >
              Đóng
            </button>
            <button type="submit" disabled={!reasonOk || returnReq.isPending} className={ui.btnPrimary}>
              {returnReq.isPending ? 'Đang gửi…' : 'Gửi yêu cầu'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function ReturnStatus({ request: r }: { request: ReturnRequestDTO }) {
  const view =
    r.status === 'APPROVED'
      ? { Icon: CheckCircle2, tone: 'text-success-fg', text: 'Đổi/trả đã được duyệt — tiền hoàn vào Ví Tubu.' }
      : r.status === 'REJECTED'
        ? { Icon: XCircle, tone: 'text-danger-fg', text: `Yêu cầu đổi/trả bị từ chối${r.adminNote ? `: ${r.adminNote}` : '.'}` }
        : { Icon: Clock, tone: 'text-stone-700', text: 'Yêu cầu đổi/trả đang được xử lý (phản hồi trong 24 giờ).' };
  return (
    <p role="status" className={`mt-3 flex items-start gap-2 text-sm ${view.tone}`}>
      <view.Icon className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
      <span className="min-w-0 break-words">{view.text}</span>
    </p>
  );
}
