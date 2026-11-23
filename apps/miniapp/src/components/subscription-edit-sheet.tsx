import { useState } from 'react';
import { RESCHEDULE_MAX_DAYS_AHEAD, type SubscriptionPatch } from '@tubutree/app-core/api/subscriptions';
import { dayKeyText, isRescheduleDateAllowed, rescheduleOptions, rescheduleRange, selfServeCopy } from '@tubutree/app-core/subscription-self-serve';
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
import { joinVariationLine, variationLabel } from '../utils/variation-label';
import { vi } from '../i18n/vi';
import { useSyncedDraft } from '../hooks/use-synced-draft';
import { useLockedMutation } from './game/use-locked-mutation';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { Chip } from './ui/chip';
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

/** Chỉ gửi trường đã đổi: PATCH trống không làm gì, và đổi địa chỉ là bước API kiểm trùng gói. Ngày giao kỳ tới chỉ gửi khi nằm trong khoảng API nhận. */
export function subscriptionPatch(
  sub: Pick<SubscriptionDTO, 'quantity' | 'addressId' | 'paymentMethod' | 'intervalWeeks'> & { nextRunAt?: string },
  next: { quantity: number; addressId: string | undefined; paymentMethod: SubscriptionPaymentMethod; intervalWeeks: number; nextRunDate?: string | null },
  now: Date = new Date(),
) {
  const patch: SubscriptionPatch = {};
  if (next.quantity !== sub.quantity) patch.quantity = next.quantity;
  if (next.addressId && next.addressId !== sub.addressId) patch.addressId = next.addressId;
  if (next.paymentMethod !== (sub.paymentMethod ?? 'COD')) patch.paymentMethod = next.paymentMethod;
  if (next.intervalWeeks !== sub.intervalWeeks) patch.intervalWeeks = next.intervalWeeks;
  if (next.nextRunDate && isRescheduleDateAllowed(next.nextRunDate, now)) {
    patch.nextRunDate = next.nextRunDate;
    patch.expectedNextRunAt = sub.nextRunAt;
  }
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
  // Ngày giao kỳ tới khách chọn ('yyyy-mm-dd' giờ VN), null = giữ lịch. `picking`: đang mở ô chọn ngày.
  const [runDate, setRunDate] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const patch = subscriptionPatch(sub, { quantity, addressId, paymentMethod: payment, intervalWeeks: weeks, nextRunDate: runDate });
  const nextRun = nextRunAfterIntervalChange(sub, weeks);
  const dirty = Object.keys(patch).length > 0;
  // +7/+14 ngày tính từ ngày giao kỳ tới đang thấy (kể cả ngày mới do đổi chu kỳ); ngày chọn thắng ngày do đổi chu kỳ ở máy chủ.
  const steps = rescheduleOptions(nextRun ? nextRun.toISOString() : sub.nextRunAt);
  const range = rescheduleRange();

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
      description={joinVariationLine(sub.productName, variationLabel(sub.variationName))}
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
      <IntervalPicker
        value={weeks}
        onChange={(w) => {
          draft.set('weeks', w);
          // +7/+14 tính từ ngày của chu kỳ đang chọn: đổi chu kỳ thì bỏ bước đã chọn kẻo PATCH gửi ngày cũ đè ngày mới. Ngày tự chọn giữ nguyên.
          if (!picking) setRunDate(null);
        }}
        disabled={save.isPending}
      />
      {nextRun && !patch.nextRunDate && (
        <Text variant="caption" tone="tertiary" as="div" numeric>
          {t.intervalNextRun(formatVnDate(vnDateOf(nextRun)))}
        </Text>
      )}
      {sub.status === 'PAUSED' && weeks !== sub.intervalWeeks && (
        <Text variant="caption" tone="tertiary" as="div">
          {t.intervalPausedHint}
        </Text>
      )}

      {steps.length > 0 && (
        <>
          <SectionLabel>{selfServeCopy('rescheduleLabel')}</SectionLabel>
          <div role="group" aria-label={selfServeCopy('rescheduleLabel')} data-testid="subscription-reschedule" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-inline-sm)', padding: 'var(--space-stack-xs) 0' }}>
            {steps.map((o) => (
              <Chip
                key={o.days}
                selected={!picking && runDate === o.date}
                disabled={save.isPending || !o.allowed}
                onPress={() => {
                  setPicking(false);
                  setRunDate(!picking && runDate === o.date ? null : o.date);
                }}
              >
                {selfServeCopy('plusDays', { n: o.days })}
              </Chip>
            ))}
            <Chip
              selected={picking}
              disabled={save.isPending}
              onPress={() => {
                setPicking(!picking);
                setRunDate(null);
              }}
            >
              {selfServeCopy('pickDate')}
            </Chip>
          </div>
          {/* Tiêu đề mục ngay trên đã là nhãn nhìn thấy: ô chỉ cần tên cho trình đọc màn hình, không lặp nhãn thứ hai. */}
          {picking && (
            <input
              type="date"
              aria-label={selfServeCopy('rescheduleLabel')}
              className="tubu-input"
              value={runDate ?? ''}
              min={range.min}
              max={range.max}
              disabled={save.isPending}
              onChange={(e) => setRunDate(e.target.value || null)}
            />
          )}
          {/* Ô ngày giới hạn min/max; ngày ngoài khoảng không vào PATCH nên câu gợi ý ở lại tới khi chọn được ngày hợp lệ. */}
          {(patch.nextRunDate || picking) && (
            <Text variant="caption" tone="tertiary" as="div" numeric>
              {patch.nextRunDate ? selfServeCopy('rescheduleNext', { date: dayKeyText(patch.nextRunDate) }) : selfServeCopy('rescheduleHint', { max: RESCHEDULE_MAX_DAYS_AHEAD })}
            </Text>
          )}
        </>
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
