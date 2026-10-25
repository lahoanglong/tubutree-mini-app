import { useEffect, useState } from 'react';
import { useNavigate, useSnackbar } from 'zmp-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAddresses } from '../services/shop-api';
import { getWallet } from '../services/account-api';
import {
  createSubscription,
  MAX_START_DAYS_AHEAD,
  type SubscriptionPaymentMethod,
} from '../services/subscriptions-api';
import { getErrorMessage } from '../services/api';
import { haptic } from '../utils/haptic';
import { usePublicConfig } from '../hooks/use-public-config';
import { vi } from '../i18n/vi';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { Chip } from './ui/chip';
import { Field } from './ui/form';
import { Text } from './ui/text';
import {
  AddressPicker,
  formatVnDate,
  IntervalPicker,
  isStartDateAllowed,
  PaymentMethodPicker,
  SectionLabel,
  startDateRange,
} from './subscription-options';

export function SubscribeSheet({
  visible,
  onClose,
  variationId,
  quantity,
}: {
  visible: boolean;
  onClose: () => void;
  variationId: string;
  quantity: number;
}) {
  const t = vi.subscriptions;
  const { openSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [weeks, setWeeks] = useState(4);
  const [startMode, setStartMode] = useState<'now' | 'date'>('now');
  const [startDate, setStartDate] = useState('');
  const [payment, setPayment] = useState<SubscriptionPaymentMethod>('COD');
  const [addressId, setAddressId] = useState<string | undefined>();
  const discountPct = Math.round(usePublicConfig().subscribeDiscountPct * 100);
  const addrQ = useQuery({ queryKey: ['addresses'], queryFn: getAddresses, enabled: visible });
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: getWallet, enabled: visible });
  const addresses = addrQ.data ?? [];
  const defaultAddr = addresses.find((a) => a.isDefault) ?? addresses[0];

  useEffect(() => {
    if (!addressId && defaultAddr) setAddressId(defaultAddr.id);
  }, [addressId, defaultAddr]);

  const range = startDateRange();
  const dateOk = startMode === 'now' || isStartDateAllowed(startDate);
  const dateError = startMode === 'date' && startDate !== '' && !dateOk ? t.startDateInvalid(MAX_START_DAYS_AHEAD) : undefined;

  // Payload dựng ở onPress (closure của lần render vừa commit) rồi truyền vào mutate: mutationFn trong options chỉ
  // được cập nhật ở effect, chạm ngay khi địa chỉ mặc định vừa hiện có thể gửi addressId cũ (undefined).
  const create = useMutation({
    mutationFn: (input: Parameters<typeof createSubscription>[0]) => createSubscription(input),
    onSuccess: (sub, input) => {
      haptic('medium');
      void qc.invalidateQueries({ queryKey: ['subscriptions'] });
      const first = sub.firstOrder;
      if (first) {
        void qc.invalidateQueries({ queryKey: ['orders'] });
        if (first.paymentMethod === 'WALLET') void qc.invalidateQueries({ queryKey: ['wallet'] });
      }
      onClose();
      if (first?.paymentMethod === 'BANK_TRANSFER' && first.status === 'PENDING_PAYMENT') {
        openSnackbar({ text: t.createdAwaitTransfer(first.code), type: 'success' });
        navigate(`/bank-payment/${first.code}`);
        return;
      }
      // Giao ngay mà không có đơn đầu = API trả lại gói y hệt đã có (bấm đúp/thử lại).
      const text = first
        ? t.createdNow(first.code)
        : !input.startDate
          ? t.createdExisting
          : t.createdScheduled(formatVnDate(input.startDate));
      openSnackbar({ text, type: 'success' });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const noAddress = addrQ.isSuccess && addresses.length === 0;

  return (
    <BottomSheet
      open={visible}
      onClose={onClose}
      title={t.sheetTitle(discountPct)}
      description={t.sheetBody}
      size="full"
      footer={
        noAddress ? undefined : (
          <Button
            fullWidth
            loading={create.isPending}
            disabled={!addressId || !dateOk}
            onPress={() => {
              if (!addressId) return;
              create.mutate({
                variationId,
                quantity,
                intervalWeeks: weeks,
                addressId,
                paymentMethod: payment,
                ...(startMode === 'date' ? { startDate } : {}),
              });
            }}
          >
            {t.createCta}
          </Button>
        )
      }
    >
      <SectionLabel>{t.intervalLabel}</SectionLabel>
      <IntervalPicker value={weeks} onChange={setWeeks} />

      <SectionLabel>{t.startLabel}</SectionLabel>
      <div role="group" aria-label={t.startLabel} style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
        <Chip selected={startMode === 'now'} onPress={() => setStartMode('now')}>
          {t.startNow}
        </Chip>
        <Chip
          selected={startMode === 'date'}
          onPress={() => {
            setStartMode('date');
            if (!startDate) setStartDate(range.min);
          }}
        >
          {t.startPick}
        </Chip>
      </div>
      {startMode === 'now' ? (
        <Text variant="caption" tone="tertiary" as="p" style={{ marginTop: 4 }}>
          {t.startNowHint}
        </Text>
      ) : (
        <div style={{ marginTop: 8 }}>
          <Field label={t.startDateLabel} error={dateError}>
            <input
              type="date"
              value={startDate}
              min={range.min}
              max={range.max}
              onChange={(e) => setStartDate(e.target.value)}
              style={{
                width: '100%',
                minHeight: 44,
                padding: '10px 12px',
                borderRadius: 'var(--radius-control)',
                border: '1px solid var(--color-border-subtle)',
                background: 'var(--color-bg-surface)',
                color: 'var(--color-text-primary)',
                fontFamily: 'inherit',
                fontSize: 16,
                boxSizing: 'border-box',
              }}
            />
          </Field>
          {!dateError && (
            <Text variant="caption" tone="tertiary" as="p" style={{ marginTop: 4 }}>
              {t.startDateHint(MAX_START_DAYS_AHEAD)}
            </Text>
          )}
        </div>
      )}

      <SectionLabel>{t.paymentLabel}</SectionLabel>
      <PaymentMethodPicker value={payment} onChange={setPayment} walletBalance={walletQ.data?.walletBalance} />

      <SectionLabel>{t.addressLabel}</SectionLabel>
      {noAddress ? (
        <div>
          <Text variant="body-sm" tone="danger" as="p">
            {t.needAddress}
          </Text>
          <Button
            fullWidth
            variant="secondary"
            style={{ marginTop: 8 }}
            onPress={() => {
              onClose();
              navigate('/addresses');
            }}
          >
            {t.addAddress}
          </Button>
        </div>
      ) : (
        <AddressPicker addresses={addresses} value={addressId} onChange={setAddressId} />
      )}
    </BottomSheet>
  );
}
