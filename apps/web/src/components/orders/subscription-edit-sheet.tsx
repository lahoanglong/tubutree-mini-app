'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { updateSubscription, type SubscriptionDTO, type SubscriptionPaymentMethod } from '@tubutree/app-core/api/subscriptions';
import { addressesQuery } from '@tubutree/app-core/queries/checkout';
import { walletQuery } from '@tubutree/app-core/queries/wallet';
import { Chip } from '@/components/catalog/chip';
import { Sheet } from '@/components/ui/sheet';
import { QuantitySelector } from '@/components/ui/quantity-selector';
import { LineItemSkeleton } from '@/components/ui/skeleton';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { formatVnDate, nextRunAfterIntervalChange, SUBSCRIPTION_INTERVAL_WEEKS, vnDateOf } from '@/lib/subscription-options';
import { AddressPicker, PaymentMethodPicker, SectionLabel } from './subscription-options';
import { actionErrorText } from '@/lib/error-text';

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
export function SubscriptionEditSheet({ sub, onClose, onSaved }: { sub: SubscriptionDTO; onClose: () => void; onSaved: (text: string) => void }) {
  const qc = useQueryClient();
  const [quantity, setQuantity] = useState(sub.quantity);
  const [weeks, setWeeks] = useState(sub.intervalWeeks);
  const [addressId, setAddressId] = useState(sub.addressId);
  const [payment, setPayment] = useState<SubscriptionPaymentMethod>(sub.paymentMethod ?? 'COD');
  const addrQ = useQuery(addressesQuery(coreHttp));
  const walletQ = useQuery(walletQuery(coreHttp));

  // API cũ chưa nhận intervalWeeks (400); chỉ API mới mới trả khoá lastOrderAt (kể cả null), dùng làm dấu hiệu hỗ trợ.
  const canEditInterval = 'lastOrderAt' in sub;
  const patch = subscriptionPatch(sub, { quantity, addressId, paymentMethod: payment, intervalWeeks: weeks }, canEditInterval);
  const nextRun = canEditInterval ? nextRunAfterIntervalChange(sub, weeks) : null;
  const dirty = Object.keys(patch).length > 0;

  const save = useMutation({
    mutationFn: () => updateSubscription(coreHttp, sub.id, patch),
    onSuccess: () => {
      onSaved('Đã cập nhật gói định kỳ');
      void qc.invalidateQueries({ queryKey: ['subscriptions'] });
      onClose();
    },
  });

  return (
    <Sheet
      open
      onClose={onClose}
      title="Sửa gói định kỳ"
      description={`${sub.productName}${sub.variationName ? ` · ${sub.variationName}` : ''}`}
      size="full"
      footer={
        <div className="flex flex-col gap-2">
          {save.isError && (
            <p role="alert" className={ui.error}>
              {actionErrorText(save.error)}
            </p>
          )}
          <button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate()} className={`${ui.btnPrimary} w-full`}>
            {save.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}
          </button>
        </div>
      }
    >
      <SectionLabel>Số lượng mỗi kỳ</SectionLabel>
      <div className="py-1">
        <QuantitySelector value={quantity} min={1} max={MAX_QTY} onChange={setQuantity} />
      </div>

      {canEditInterval && (
        <>
        <SectionLabel>Chu kỳ giao</SectionLabel>
        <div role="group" aria-label="Chu kỳ giao" className="flex flex-wrap gap-2 py-1">
          {SUBSCRIPTION_INTERVAL_WEEKS.map((w) => (
            <Chip key={w} selected={weeks === w} onPress={() => setWeeks(w)}>
              {w} tuần
            </Chip>
          ))}
        </div>
        {nextRun && <p className="text-xs text-stone-600">Lần giao kế tiếp: {formatVnDate(vnDateOf(nextRun))}</p>}
        {sub.status === 'PAUSED' && weeks !== sub.intervalWeeks && (
          <p className="text-xs text-stone-600">Gói đang tạm dừng: nếu đến lúc bật lại mà ngày này đã qua, ngày giao kế tiếp sẽ tính từ ngày bật lại.</p>
        )}
        </>
      )}

      <SectionLabel>Thanh toán mỗi kỳ</SectionLabel>
      <PaymentMethodPicker value={payment} onChange={setPayment} walletBalance={walletQ.data?.walletBalance} />

      <SectionLabel>Giao tới</SectionLabel>
      {addrQ.isLoading ? <LineItemSkeleton /> : <AddressPicker addresses={addrQ.data ?? []} value={addressId} onChange={setAddressId} />}
    </Sheet>
  );
}
