import { useState } from 'react';
import { useSnackbar } from 'zmp-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAddresses } from '../services/shop-api';
import { getWallet } from '../services/account-api';
import {
  isStaleSubscriptionError,
  updateSubscription,
  type SubscriptionDTO,
  type SubscriptionPaymentMethod,
} from '../services/subscriptions-api';
import { getErrorMessage, getLoadErrorMessage, isTargetGoneError } from '../services/api';
import { haptic } from '../utils/haptic';
import { settleWithin } from '../utils/settle-within';
import { vi } from '../i18n/vi';
import { useSyncedDraft } from '../hooks/use-synced-draft';
import { useLockedMutation } from './game/use-locked-mutation';
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

type EditForm = { quantity: number; weeks: number; addressId: string; payment: SubscriptionPaymentMethod };
const EDIT_EMPTY: EditForm = { quantity: 1, weeks: 1, addressId: '', payment: 'COD' };
const toEditForm = (sub: SubscriptionDTO): EditForm => ({
  quantity: sub.quantity,
  weeks: sub.intervalWeeks,
  addressId: sub.addressId ?? '',
  payment: sub.paymentMethod ?? 'COD',
});

/** Sửa số lượng / chu kỳ / địa chỉ / cách trả của gói đang chạy hoặc tạm dừng (C-015). Mount khi mở để state lấy từ gói đang chọn. */
export function SubscriptionEditSheet({ sub, onClose }: { sub: SubscriptionDTO; onClose: () => void }) {
  const t = vi.subscriptions;
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  // `sub` là gói SỐNG của cha (danh sách `subscriptions`): danh sách tải lại lúc sheet còn mở thì lựa chọn chưa chạm đổi theo, lựa chọn khách đã đổi giữ nguyên.
  const draft = useSyncedDraft(EDIT_EMPTY, toEditForm(sub), true);
  const { quantity, weeks, addressId, payment } = draft.values;
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

  const save = useLockedMutation({
    mutationFn: () => updateSubscription(sub.id, patch),
    onSuccess: () => {
      haptic('light');
      openSnackbar({ text: t.saved, type: 'success' });
      void qc.invalidateQueries({ queryKey: ['subscriptions'] });
      onClose();
    },
    onError: (e) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      // Gói đã huỷ ở máy khác (sheet tự đóng khi gói rời danh sách), đã có gói trùng hoặc địa chỉ không còn: danh sách gói và địa chỉ đang cũ.
      // Trả Promise từ onError (không phải onSettled, vốn chạy sau và là nơi nhả khoá) để nút Lưu giữ khoá tới khi dữ liệu mới về.
      if (!isStaleSubscriptionError(e)) return undefined;
      const held = settleWithin(
        Promise.all([qc.invalidateQueries({ queryKey: ['subscriptions'] }), qc.invalidateQueries({ queryKey: ['addresses'] })]),
      );
      // Sheet có ô người dùng chọn: chỉ đóng khi gói không còn hoặc vừa đổi (404/409), đóng SAU khi dữ liệu mới về; 400 là lỗi ở lựa chọn (địa chỉ, số lượng...), giữ sheet để sửa.
      // Không cần tách đích: `dismissible` khoá việc đóng tay suốt lúc lệnh bay và lúc giữ khoá, sheet này vẫn đúng là sheet của gói bị từ chối.
      return isTargetGoneError(e) ? held.then(() => onClose()) : held;
    },
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
            <div role="alert" style={{ marginBottom: '0.375rem' }}>
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
        <QuantitySelector value={quantity} min={1} max={MAX_QTY} disabled={save.isPending} onChange={(n) => draft.set('quantity', n)} />
      </div>

      <SectionLabel>{t.intervalLabel}</SectionLabel>
      <IntervalPicker value={weeks} onChange={(w) => draft.set('weeks', w)} disabled={save.isPending} />
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
      <PaymentMethodPicker value={payment} onChange={(p) => draft.set('payment', p)} walletBalance={walletQ.data?.walletBalance} disabled={save.isPending} />

      <SectionLabel>{t.addressLabel}</SectionLabel>
      {addrFailed || addrWaiting ? (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', padding: '0.25rem 0' }}>
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
        <AddressPicker addresses={addrQ.data ?? []} value={addressId} onChange={(id) => draft.set('addressId', id)} disabled={save.isPending} />
      )}
    </BottomSheet>
  );
}
