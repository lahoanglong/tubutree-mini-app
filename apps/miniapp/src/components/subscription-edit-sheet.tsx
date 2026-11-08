import { useState } from 'react';
import { useSnackbar } from 'zmp-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAddresses } from '../services/shop-api';
import { getWallet } from '../services/account-api';
import {
  updateSubscription,
  type SubscriptionDTO,
  type SubscriptionPaymentMethod,
} from '../services/subscriptions-api';
import { getErrorMessage, getLoadErrorMessage } from '../services/api';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { QuantitySelector } from './ui/quantity-selector';
import { LineItemSkeleton } from './ui/skeleton';
import { Text } from './ui/text';
import {
  AddressPicker,
  formatVnDate,
  IntervalPicker,
  nextRunAfterIntervalChange,
  PaymentMethodPicker,
  SectionLabel,
  vnDateOf,
} from './subscription-options';

/** Trần ở client chỉ để nút + không chạy vô hạn; còn hàng hay không do API kiểm khi sinh đơn kỳ. */
const MAX_QTY = 99;

/** Chỉ gửi trường đã đổi: PATCH trống không làm gì, và đổi địa chỉ là bước API kiểm trùng gói. */
export function subscriptionPatch(
  sub: Pick<SubscriptionDTO, 'quantity' | 'addressId' | 'paymentMethod' | 'intervalWeeks'>,
  next: { quantity: number; addressId: string | undefined; paymentMethod: SubscriptionPaymentMethod; intervalWeeks: number },
) {
  const patch: { quantity?: number; addressId?: string; paymentMethod?: SubscriptionPaymentMethod; intervalWeeks?: number } = {};
  if (next.quantity !== sub.quantity) patch.quantity = next.quantity;
  if (next.addressId && next.addressId !== sub.addressId) patch.addressId = next.addressId;
  if (next.paymentMethod !== (sub.paymentMethod ?? 'COD')) patch.paymentMethod = next.paymentMethod;
  if (next.intervalWeeks !== sub.intervalWeeks) patch.intervalWeeks = next.intervalWeeks;
  return patch;
}

/** Sửa số lượng / chu kỳ / địa chỉ / cách trả của gói đang chạy hoặc tạm dừng (C-015). Mount khi mở để state lấy từ gói đang chọn. */
export function SubscriptionEditSheet({ sub, onClose }: { sub: SubscriptionDTO; onClose: () => void }) {
  const t = vi.subscriptions;
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const [quantity, setQuantity] = useState(sub.quantity);
  const [weeks, setWeeks] = useState(sub.intervalWeeks);
  const [addressId, setAddressId] = useState(sub.addressId);
  const [payment, setPayment] = useState<SubscriptionPaymentMethod>(sub.paymentMethod ?? 'COD');
  const addrQ = useQuery({ queryKey: ['addresses'], queryFn: getAddresses });
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: getWallet });
  // Truy vấn lỗi mà chưa có dữ liệu bị react-query đặt về pending lúc tải lại và xoá lỗi; giữ vùng lỗi + nút Thử lại đứng yên
  // (không mất focus) tới khi lượt tải lại có kết quả (isPending hết). Giá trị là câu lỗi cũ để vẫn hiện chữ trong lúc chờ.
  const [addrRetrying, setAddrRetrying] = useState<string | null>(null);
  const addrFailed = addrQ.isError && !addrQ.data;
  const addrWaiting = addrRetrying !== null && addrQ.isPending;

  const patch = subscriptionPatch(sub, { quantity, addressId, paymentMethod: payment, intervalWeeks: weeks });
  const nextRun = nextRunAfterIntervalChange(sub, weeks);
  const dirty = Object.keys(patch).length > 0;

  const save = useMutation({
    mutationFn: () => updateSubscription(sub.id, patch),
    onSuccess: () => {
      haptic('light');
      openSnackbar({ text: t.saved, type: 'success' });
      void qc.invalidateQueries({ queryKey: ['subscriptions'] });
      onClose();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <BottomSheet
      open
      onClose={() => {
        if (!save.isPending) onClose();
      }}
      dismissible={!save.isPending}
      title={t.editTitle}
      description={`${sub.productName}${sub.variationName ? ` · ${sub.variationName}` : ''}`}
      size="full"
      footer={
        <>
          {save.isError && (
            <div role="alert" style={{ marginBottom: 6 }}>
              <Text variant="caption" tone="danger" as="div">
                {getErrorMessage(save.error)}
              </Text>
            </div>
          )}
          <Button fullWidth loading={save.isPending} disabled={!dirty} onPress={() => save.mutate()}>
            {t.saveCta}
          </Button>
        </>
      }
    >
      <SectionLabel>{t.quantityLabel}</SectionLabel>
      <div style={{ padding: '4px 0' }}>
        <QuantitySelector value={quantity} min={1} max={MAX_QTY} disabled={save.isPending} onChange={setQuantity} />
      </div>

      <SectionLabel>{t.intervalLabel}</SectionLabel>
      <IntervalPicker value={weeks} onChange={setWeeks} disabled={save.isPending} />
      {nextRun && (
        <Text variant="caption" tone="tertiary" as="div" numeric>
          {t.intervalNextRun(formatVnDate(vnDateOf(nextRun)))}
        </Text>
      )}
      {sub.status === 'PAUSED' && weeks !== sub.intervalWeeks && (
        <Text variant="caption" tone="tertiary" as="div">
          {t.intervalPausedHint}
        </Text>
      )}

      <SectionLabel>{t.paymentLabel}</SectionLabel>
      <PaymentMethodPicker value={payment} onChange={setPayment} walletBalance={walletQ.data?.walletBalance} disabled={save.isPending} />

      <SectionLabel>{t.addressLabel}</SectionLabel>
      {addrFailed || addrWaiting ? (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '4px 0' }}>
          <Text variant="body-sm" tone="danger" as="div" style={{ flex: 1, minWidth: 0 }}>
            {addrFailed ? getLoadErrorMessage(addrQ.error) : addrRetrying}
          </Text>
          <Button
            variant="secondary"
            loading={addrWaiting}
            onPress={() => {
              setAddrRetrying(getLoadErrorMessage(addrQ.error));
              return addrQ.refetch();
            }}
          >
            {vi.common.retry}
          </Button>
        </div>
      ) : addrQ.isLoading ? (
        <LineItemSkeleton />
      ) : (
        <AddressPicker addresses={addrQ.data ?? []} value={addressId} onChange={setAddressId} disabled={save.isPending} />
      )}
    </BottomSheet>
  );
}
