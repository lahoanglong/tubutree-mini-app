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
import { getErrorMessage } from '../services/api';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { QuantitySelector } from './ui/quantity-selector';
import { LineItemSkeleton } from './ui/skeleton';
import { AddressPicker, PaymentMethodPicker, SectionLabel } from './subscription-options';

/** Trần ở client chỉ để nút + không chạy vô hạn; còn hàng hay không do API kiểm khi sinh đơn kỳ. */
const MAX_QTY = 99;

/** Chỉ gửi trường đã đổi: PATCH trống không làm gì, và đổi địa chỉ là bước API kiểm trùng gói. */
export function subscriptionPatch(
  sub: Pick<SubscriptionDTO, 'quantity' | 'addressId' | 'paymentMethod'>,
  next: { quantity: number; addressId: string | undefined; paymentMethod: SubscriptionPaymentMethod },
) {
  const patch: { quantity?: number; addressId?: string; paymentMethod?: SubscriptionPaymentMethod } = {};
  if (next.quantity !== sub.quantity) patch.quantity = next.quantity;
  if (next.addressId && next.addressId !== sub.addressId) patch.addressId = next.addressId;
  if (next.paymentMethod !== (sub.paymentMethod ?? 'COD')) patch.paymentMethod = next.paymentMethod;
  return patch;
}

/** Sửa số lượng / địa chỉ / cách trả của gói đang chạy hoặc tạm dừng (C-015). Mount khi mở để state lấy từ gói đang chọn. */
export function SubscriptionEditSheet({ sub, onClose }: { sub: SubscriptionDTO; onClose: () => void }) {
  const t = vi.subscriptions;
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const [quantity, setQuantity] = useState(sub.quantity);
  const [addressId, setAddressId] = useState(sub.addressId);
  const [payment, setPayment] = useState<SubscriptionPaymentMethod>(sub.paymentMethod ?? 'COD');
  const addrQ = useQuery({ queryKey: ['addresses'], queryFn: getAddresses });
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: getWallet });

  const patch = subscriptionPatch(sub, { quantity, addressId, paymentMethod: payment });
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
      onClose={onClose}
      title={t.editTitle}
      description={`${sub.productName}${sub.variationName ? ` · ${sub.variationName}` : ''}`}
      size="full"
      footer={
        <Button fullWidth loading={save.isPending} disabled={!dirty} onPress={() => save.mutate()}>
          {t.saveCta}
        </Button>
      }
    >
      <SectionLabel>{t.quantityLabel}</SectionLabel>
      <div style={{ padding: '4px 0' }}>
        <QuantitySelector value={quantity} min={1} max={MAX_QTY} onChange={setQuantity} />
      </div>

      <SectionLabel>{t.paymentLabel}</SectionLabel>
      <PaymentMethodPicker value={payment} onChange={setPayment} walletBalance={walletQ.data?.walletBalance} />

      <SectionLabel>{t.addressLabel}</SectionLabel>
      {addrQ.isLoading ? (
        <LineItemSkeleton />
      ) : (
        <AddressPicker addresses={addrQ.data ?? []} value={addressId} onChange={setAddressId} />
      )}
    </BottomSheet>
  );
}
