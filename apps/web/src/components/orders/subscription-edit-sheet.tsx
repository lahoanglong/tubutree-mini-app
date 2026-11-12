'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { updateSubscription, type SubscriptionDTO, type SubscriptionPaymentMethod } from '@tubutree/app-core/api/subscriptions';
import { addressesQuery } from '@tubutree/app-core/queries/checkout';
import { walletQuery } from '@tubutree/app-core/queries/wallet';
import { Chip } from '@/components/catalog/chip';
import { Sheet } from '@/components/ui/sheet';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { QuantitySelector } from '@/components/ui/quantity-selector';
import { LineItemSkeleton } from '@/components/ui/skeleton';
import { coreHttp } from '@/lib/core-http';
import { isStaleSubscriptionError } from '@/lib/subscription-stale-error';
import { ui } from '@/lib/guest-ui';
import { formatVnDate, nextRunAfterIntervalChange, SUBSCRIPTION_INTERVAL_WEEKS, vnDateOf } from '@/lib/subscription-options';
import { AddressPicker, PaymentMethodPicker, SectionLabel } from './subscription-options';
import { actionErrorText, loadErrorText } from '@/lib/error-text';
import { joinVariationLine, variationLabel } from '@/lib/variation-label';

/** Trần ở client chỉ để nút + không chạy vô hạn; còn hàng hay không do API kiểm khi sinh đơn kỳ. */
const MAX_QTY = 99;

/** Chỉ gửi trường đã đổi: PATCH trống không làm gì, và đổi địa chỉ là bước API kiểm trùng gói. */
export function subscriptionPatch(
  sub: Pick<SubscriptionDTO, 'quantity' | 'addressId' | 'paymentMethod' | 'intervalWeeks'>,
  next: { quantity: number; addressId: string | undefined; paymentMethod: SubscriptionPaymentMethod; intervalWeeks: number },
  canEditInterval = true,
) {
  const patch: { quantity?: number; addressId?: string; paymentMethod?: SubscriptionPaymentMethod; intervalWeeks?: number } = {};
  if (next.quantity !== sub.quantity) patch.quantity = next.quantity;
  if (next.addressId && next.addressId !== sub.addressId) patch.addressId = next.addressId;
  if (next.paymentMethod !== (sub.paymentMethod ?? 'COD')) patch.paymentMethod = next.paymentMethod;
  if (canEditInterval && next.intervalWeeks !== sub.intervalWeeks) patch.intervalWeeks = next.intervalWeeks;
  return patch;
}

/** Sửa số lượng / chu kỳ / địa chỉ / cách trả của gói đang chạy hoặc tạm dừng. Mount khi mở để state lấy từ gói đang chọn. */
export function SubscriptionEditSheet({
  sub,
  onClose,
  onSaved,
  onRejected,
}: {
  sub: SubscriptionDTO;
  onClose: () => void;
  onSaved: (text: string) => void;
  onRejected?: (text: string) => void;
}) {
  const qc = useQueryClient();
  const [quantity, setQuantity] = useState(sub.quantity);
  const [weeks, setWeeks] = useState(sub.intervalWeeks);
  const [addressId, setAddressId] = useState(sub.addressId);
  const [payment, setPayment] = useState<SubscriptionPaymentMethod>(sub.paymentMethod ?? 'COD');
  const addrQ = useQuery(addressesQuery(coreHttp));
  const walletQ = useQuery(walletQuery(coreHttp));
  // Truy vấn lỗi mà chưa có dữ liệu bị react-query đặt về pending lúc tải lại và xoá lỗi; giữ vùng lỗi + nút Thử lại đứng yên
  // (không mất focus) tới khi lượt tải lại có kết quả (isPending hết). Giá trị là câu lỗi cũ để vẫn hiện chữ trong lúc chờ.
  const [addrRetrying, setAddrRetrying] = useState<string | null>(null);
  const addrFailed = addrQ.isError && !addrQ.data;
  const addrWaiting = addrRetrying !== null && addrQ.isPending;

  // API cũ chưa nhận intervalWeeks (400); chỉ API mới mới trả khoá lastOrderAt (kể cả null), dùng làm dấu hiệu hỗ trợ.
  const canEditInterval = 'lastOrderAt' in sub;
  const patch = subscriptionPatch(sub, { quantity, addressId, paymentMethod: payment, intervalWeeks: weeks }, canEditInterval);
  const nextRun = canEditInterval ? nextRunAfterIntervalChange(sub, weeks) : null;
  const dirty = Object.keys(patch).length > 0;

  const save = useLockedMutation({
    mutationFn: () => updateSubscription(coreHttp, sub.id, patch),
    onSuccess: () => {
      onSaved('Đã cập nhật gói định kỳ');
      void qc.invalidateQueries({ queryKey: ['subscriptions'] });
      onClose();
    },
    // Gói đã huỷ ở máy khác (sheet tự đóng khi gói rời danh sách) hoặc đã có gói trùng: danh sách đang cũ. Không giữ nút Lưu chờ nó
    // để lời lỗi và nút bấm lại hiện ngay.
    onError: (e) => {
      if (!isStaleSubscriptionError(e)) return;
      // Gói rời danh sách thì sheet tự đóng và lời lỗi trong footer biến mất cùng nó: báo lên trang để khách còn thấy lý do.
      onRejected?.(actionErrorText(e));
      void qc.invalidateQueries({ queryKey: ['subscriptions'] });
    },
  });

  return (
    <Sheet
      open
      onClose={() => {
        if (!save.isPending) onClose();
      }}
      dismissible={!save.isPending}
      title="Sửa gói định kỳ"
      description={joinVariationLine(sub.productName, variationLabel(sub.variationName))}
      size="full"
      footer={
        <div className="flex flex-col gap-2">
          {save.isError && (
            <p role="alert" className={ui.error}>
              {actionErrorText(save.error)}
            </p>
          )}
          {/* Đang lưu giữ aria-busy/aria-disabled chứ không `disabled`: nút đang giữ focus mà `disabled` thì Chromium thả focus về body; khoá chạm đúp là của useLockedMutation. */}
          <button
            type="button"
            disabled={!dirty}
            aria-busy={save.isPending || undefined}
            aria-disabled={save.isPending || undefined}
            onClick={() => save.mutate()}
            className={`${ui.btnPrimary} w-full`}
          >
            {save.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}
          </button>
        </div>
      }
    >
      <SectionLabel>Số lượng mỗi kỳ</SectionLabel>
      <div className="py-1">
        <QuantitySelector value={quantity} min={1} max={MAX_QTY} disabled={save.isPending} onChange={setQuantity} />
      </div>

      {canEditInterval && (
        <>
        <SectionLabel>Chu kỳ giao</SectionLabel>
        <div role="group" aria-label="Chu kỳ giao" className="flex flex-wrap gap-2 py-1">
          {SUBSCRIPTION_INTERVAL_WEEKS.map((w) => (
            <Chip key={w} selected={weeks === w} disabled={save.isPending} onPress={() => setWeeks(w)}>
              {w} tuần
            </Chip>
          ))}
        </div>
        {nextRun && <p className="text-xs tabular-nums text-stone-600">Lần giao kế tiếp: {formatVnDate(vnDateOf(nextRun))}</p>}
        {sub.status === 'PAUSED' && weeks !== sub.intervalWeeks && (
          <p className="text-xs text-stone-600">Gói đang tạm dừng: nếu đến lúc bật lại mà ngày này đã qua, ngày giao kế tiếp sẽ tính từ ngày bật lại.</p>
        )}
        </>
      )}

      <SectionLabel>Thanh toán mỗi kỳ</SectionLabel>
      <PaymentMethodPicker value={payment} onChange={setPayment} walletBalance={walletQ.data?.walletBalance} disabled={save.isPending} />

      <SectionLabel>Giao tới</SectionLabel>
      {addrFailed || addrWaiting ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 py-1">
          <p className={`min-w-0 flex-1 ${ui.error}`}>{addrFailed ? loadErrorText(addrQ.error) : addrRetrying}</p>
          <button
            type="button"
            aria-busy={addrWaiting || undefined}
            onClick={() => {
              setAddrRetrying(loadErrorText(addrQ.error));
              void addrQ.refetch();
            }}
            className={ui.btnSecondary}
          >
            Thử lại
          </button>
        </div>
      ) : addrQ.isLoading ? (
        <LineItemSkeleton />
      ) : (
        <AddressPicker addresses={addrQ.data ?? []} value={addressId} onChange={setAddressId} disabled={save.isPending} />
      )}
    </Sheet>
  );
}
