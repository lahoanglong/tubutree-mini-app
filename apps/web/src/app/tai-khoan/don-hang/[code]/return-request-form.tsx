'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { estimateReturn, formatVnd, requestReturn, type OrderDetailDTO, type ReturnRequestDTO } from '@/lib/shop-client';
import { formatVnNumber } from '@tubutree/app-core/number-format';
import { ui } from '@/lib/guest-ui';
import { EvidenceUpload } from '@/components/evidence-upload';
import {
  EMPTY_BANK,
  RETURN_REASONS,
  bankDetailsError,
  canRefundToBank,
  destinationBody,
  remainingByLine,
  returnFormError,
  type RefundBankInput,
  type RefundMethodChoice,
  type ReturnLineState,
  type ReturnReasonCode,
} from '@/lib/refund-rules';
import { RefundDestinationPicker } from './refund-destination-picker';
import { actionErrorText } from '@/lib/error-text';
import { IMAGES_UPLOADING } from '@/lib/image-compress';
import { serverRejectedState } from '@/lib/server-rejected-state';
import { settleWithin } from '@/lib/settle-within';

const REASON_MAX = 500;
const STEPPER_BTN =
  'inline-flex h-11 w-11 items-center justify-center rounded-control border border-stone-450 bg-stone-0 text-stone-800 transition hover:bg-stone-50 active:scale-95 disabled:text-stone-400 disabled:active:scale-100';

function initialLines(order: OrderDetailDTO, returns: ReturnRequestDTO[]): ReturnLineState[] {
  const items = order.items.filter((it): it is typeof it & { id: string } => !!it.id);
  const remaining = remainingByLine(items, returns);
  const lines = items
    .map((it) => ({
      orderItemId: it.id,
      productName: it.productName,
      variationName: it.variationName,
      remaining: remaining.get(it.id) ?? 0,
      selected: false,
      quantity: 1,
    }))
    .filter((l) => l.remaining > 0);
  if (lines.length === 1) lines[0]!.selected = true;
  return lines;
}

/** Yêu cầu đổi/trả theo dòng và số lượng (D3), lý do chọn sẵn và nơi nhận tiền hoàn (D2). Nơi gọi đổi `key` mỗi lần mở. */
export function ReturnRequestForm({
  order: o,
  returns,
  onDone,
  onClose,
}: {
  order: OrderDetailDTO;
  returns: ReturnRequestDTO[];
  onDone: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const reasonName = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [lines, setLines] = useState<ReturnLineState[]>(() => initialLines(o, returns));
  const [reasonCode, setReasonCode] = useState<ReturnReasonCode | null>(null);
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<RefundMethodChoice>('WALLET');
  const [bank, setBank] = useState<RefundBankInput>(EMPTY_BANK);
  const [images, setImages] = useState<string[]>([]);
  // Ảnh còn đang xử lý mà gửi thì yêu cầu thiếu ảnh minh chứng.
  const [imagesBusy, setImagesBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const bankAllowed = canRefundToBank(o.paymentMethod) && !o.placedForCustomer;
  const showsMoney = o.total > 0 && o.paymentMethod !== 'XU';
  const formError = returnFormError({ lines, reasonCode, reason, refundMethod: 'WALLET', bank });
  const bankError = showsMoney && bankAllowed && method === 'BANK' ? bankDetailsError(bank) : null;

  // Cùng API và cùng chữ với Mini App: số hoàn theo dòng/số lượng đang chọn, chia theo tỉ lệ sau giảm giá và điểm (D3).
  // Lỗi hay chưa tính được thì bỏ qua số, không chặn việc gửi yêu cầu.
  const picked = useMemo(
    () => lines.filter((l) => l.selected && l.quantity > 0).map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity })),
    [lines],
  );
  const estimateQ = useQuery({
    queryKey: ['return-estimate', o.code, picked, reasonCode],
    queryFn: () => estimateReturn(o.code, { items: picked, reasonCode: reasonCode ?? undefined }),
    enabled: showsMoney && picked.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: 0,
  });
  const estimated = picked.length > 0 && !estimateQ.isError && estimateQ.data?.moneyRefundable ? estimateQ.data : null;

  // Khoá đồng bộ: `submit.isPending` chỉ đổi sau lần vẽ kế, hai cú bấm "Gửi yêu cầu" sát nhau sẽ gửi hai yêu cầu.
  const sendingRef = useRef(false);
  // Lời lỗi ở state riêng: `submit.isError` chỉ bật sau khi `onError` (tải lại, tới 4 giây) xong, mà lời báo phải hiện ngay.
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submit = useMutation({
    mutationFn: () =>
      requestReturn(o.code, {
        reasonCode: reasonCode!,
        reason: reason.trim() || undefined,
        ...(images.length > 0 ? { images } : {}),
        items: lines
          .filter((l) => l.selected && l.quantity > 0)
          .map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity })),
        ...(showsMoney && bankAllowed ? destinationBody(method, bank) : {}),
      }),
    onMutate: () => setSubmitError(null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-returns'] });
      onDone();
    },
    // "Đơn đang có yêu cầu đổi/trả chờ xử lý", đơn đã đổi trạng thái: danh sách yêu cầu và đơn trên trang đang cũ, tải lại để trang hiện đúng.
    // Giữ khoá tới lúc đó (tối đa 4 giây); các lỗi khác không tải lại.
    onError: (e) => {
      setSubmitError(actionErrorText(e));
      if (!serverRejectedState(e)) return undefined;
      return settleWithin(Promise.all([qc.invalidateQueries({ queryKey: ['my-returns'] }), qc.invalidateQueries({ queryKey: ['order', o.code] })]));
    },
    onSettled: () => {
      sendingRef.current = false;
    },
  });

  // Form nằm cuối trang còn khách bấm từ menu ở đầu trang: đưa form vào tầm nhìn rồi chuyển focus vào tiêu đề để người dùng
  // bàn phím và trình đọc màn hình đứng đúng chỗ. `preventScroll` vì cuộn đã làm ở trên.
  useEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    title.scrollIntoView?.({ block: 'start' });
    title.focus({ preventScroll: true });
  }, []);

  const setLine = (id: string, patch: Partial<ReturnLineState>) =>
    setLines((ls) => ls.map((l) => (l.orderItemId === id ? { ...l, ...patch } : l)));

  return (
    <form
      aria-labelledby="return-form-title"
      className="mt-3 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (imagesBusy || sendingRef.current || submit.isPending) return;
        setTouched(true);
        if (formError || bankError) return;
        sendingRef.current = true;
        submit.mutate();
      }}
    >
      <div>
        <h3 id="return-form-title" ref={titleRef} tabIndex={-1} className="scroll-mt-4 font-semibold text-stone-900 outline-none">
          Yêu cầu đổi/trả
        </h3>
        <p className="mt-1 text-xs text-stone-600">
          Chọn đúng sản phẩm và số lượng muốn trả, Tubu phản hồi trong 24 giờ. Hàng lỗi, vỡ hay giao
          sai: đính kèm ảnh bên dưới để Tubu duyệt nhanh hơn.
        </p>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-stone-900">Sản phẩm muốn trả</legend>
        {lines.length === 0 && (
          <p className="mt-1 text-xs text-stone-600">Mọi sản phẩm của đơn đã được trả.</p>
        )}
        <ul className="mt-1 divide-y divide-stone-200">
          {lines.map((l) => (
            <li key={l.orderItemId} className="flex flex-wrap items-center gap-2 py-1">
              <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={l.selected}
                  onChange={() => setLine(l.orderItemId, { selected: !l.selected })}
                  className="h-4 w-4 flex-none accent-forest-600"
                />
                <span className="min-w-0">
                  <span className="block break-words text-sm text-stone-900">{l.productName}</span>
                  <span className="block text-xs text-stone-600">
                    {l.variationName} · còn trả được {l.remaining}
                  </span>
                </span>
              </label>
              {l.selected && l.remaining > 1 && (
                <div
                  className="flex items-center gap-1"
                  role="group"
                  aria-label={`Số lượng trả ${l.productName}`}
                >
                  <button
                    type="button"
                    aria-label={`Giảm số lượng ${l.productName}`}
                    disabled={l.quantity <= 1}
                    onClick={() => setLine(l.orderItemId, { quantity: l.quantity - 1 })}
                    className={STEPPER_BTN}
                  >
                    <Minus className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <span
                    className="w-8 text-center text-sm font-semibold tabular-nums"
                    aria-live="polite"
                  >
                    {l.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label={`Tăng số lượng ${l.productName}`}
                    disabled={l.quantity >= l.remaining}
                    onClick={() => setLine(l.orderItemId, { quantity: l.quantity + 1 })}
                    className={STEPPER_BTN}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-stone-900">Lý do</legend>
        <div className="mt-1 grid gap-1 sm:grid-cols-2">
          {RETURN_REASONS.map((r) => (
            <label
              key={r.code}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-1"
            >
              <input
                type="radio"
                name={reasonName}
                value={r.code}
                checked={reasonCode === r.code}
                onChange={() => setReasonCode(r.code)}
                className="h-4 w-4 flex-none accent-forest-600"
              />
              <span className="text-sm text-stone-900">{r.label}</span>
            </label>
          ))}
        </div>
        <label className="mt-2 block">
          <span className="text-field-label text-stone-700">Mô tả thêm</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={REASON_MAX}
            rows={3}
            placeholder={
              reasonCode === 'OTHER' ? 'Mô tả lý do (ít nhất 5 ký tự)…' : 'Không bắt buộc'
            }
            className={`${ui.field} mt-1 py-2`}
          />
        </label>
      </fieldset>

      <EvidenceUpload value={images} onChange={setImages} onBusyChange={setImagesBusy} disabled={submit.isPending} />

      {showsMoney &&
        (bankAllowed ? (
          <RefundDestinationPicker
            method={method}
            onMethod={setMethod}
            bank={bank}
            onBank={setBank}
            bankError={touched ? bankError : null}
          />
        ) : (
          <p className="text-xs text-stone-600">
            {o.placedForCustomer
              ? 'Tiền hoàn của đơn này trả cho khách của bạn (vào Ví Tubu của khách, hoặc Tubu chuyển khoản nếu khách chưa có tài khoản), không vào ví của bạn.'
              : 'Tiền hoàn của đơn này về Ví Tubu ngay khi Tubu duyệt.'}
          </p>
        ))}
      {estimated && (
        <div role="status" aria-live="polite" data-testid="return-estimate" className="rounded-control bg-stone-50 p-3">
          <p className="text-sm font-semibold text-stone-900">{`Dự kiến hoàn ${formatVnd(estimated.refund)}`}</p>
          <p className="mt-0.5 text-xs text-stone-600">
            {[
              estimated.shipping > 0 ? `gồm ${formatVnd(estimated.shipping)} phí vận chuyển` : null,
              estimated.pointsUsedBack > 0 ? `hoàn lại ${formatVnNumber(estimated.pointsUsedBack)} Điểm Xanh đã dùng` : null,
              'Tubu xác nhận số cuối cùng khi duyệt',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      )}
      <p className="text-xs text-stone-600">
        Số tiền hoàn = giá trị sản phẩm trả sau khi trừ phần giảm giá và điểm đã dùng tương ứng. Phí
        ship chỉ hoàn khi trả cả đơn hoặc lỗi do Tubu.
      </p>

      {touched && formError && (
        <p role="alert" className={ui.error}>
          {formError}
        </p>
      )}
      {submitError && (
        <p role="alert" className={ui.error}>
          {submitError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={submit.isPending}
          className={ui.btnSecondary}
        >
          Đóng
        </button>
        {/* Đang gửi dùng aria-disabled chứ không `disabled`: nút đang giữ focus mà `disabled` thì Chromium thả focus về <body>;
            lần gửi thứ hai đã bị onSubmit chặn. Hết dòng để trả hoặc ảnh còn đang xử lý thì vẫn `disabled` (chưa có gì đủ để gửi). */}
        <button
          type="submit"
          disabled={lines.length === 0 || imagesBusy}
          aria-busy={submit.isPending || undefined}
          aria-disabled={submit.isPending || undefined}
          className={ui.btnPrimary}
        >
          {submit.isPending ? 'Đang gửi…' : imagesBusy ? IMAGES_UPLOADING : 'Gửi yêu cầu'}
        </button>
      </div>
    </form>
  );
}
