import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'zmp-ui';
import { CheckCircle2, Clock, TriangleAlert } from 'lucide-react';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';
import { RefundDestinationPicker } from './refund-destination-picker';
import { chooseRefundDestination, fetchMyRefunds, fetchRefundBank } from '../../services/shop-api';
import { getErrorMessage } from '../../services/api';
import { formatVnd } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import {
  EMPTY_BANK,
  bankDetailsError,
  destinationBody,
  refundStatusText,
  type MyRefund,
  type RefundBankInput,
  type RefundMethodChoice,
} from '../../utils/refund-rules';

const TONE_ICON = { success: CheckCircle2, warning: TriangleAlert, muted: Clock } as const;
const TONE_TEXT = { success: 'success', warning: 'warning', muted: 'secondary' } as const;

/** Khoản hoàn tiền của đơn (chuyển khoản chờ xử lý, tiền về muộn): trạng thái từng bước và nút chọn nơi nhận (D2). */
export function OrderRefunds({ orderId }: { orderId: string }) {
  const refunds = useQuery({ queryKey: ['my-refunds', orderId], queryFn: () => fetchMyRefunds(orderId) });
  const [choosing, setChoosing] = useState<MyRefund | null>(null);
  if (!refunds.data?.length) return null;

  return (
    <section aria-label="Hoàn tiền" style={{ background: 'var(--color-bg-surface)', padding: 16, marginTop: 8 }}>
      <Text variant="body-sm" as="div" style={{ fontWeight: 600, marginBottom: 6 }}>
        Hoàn tiền
      </Text>
      {refunds.data.map((r) => {
        const s = refundStatusText(r);
        return (
          <div key={r.id} style={{ padding: '6px 0', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <Icon icon={TONE_ICON[s.tone]} size="sm" tone={s.tone === 'success' ? 'brand' : 'muted'} style={{ marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text variant="body-sm" tone={TONE_TEXT[s.tone]} as="div" style={{ fontWeight: 600 }}>
                {s.title} · {formatVnd(r.amount)}
              </Text>
              {s.detail && (
                <Text variant="caption" tone="secondary" as="div">
                  {s.detail}
                </Text>
              )}
              {r.canChooseDestination && (
                <Button
                  variant={r.bankAccountNo ? 'ghost' : 'primary'}
                  onPress={() => {
                    haptic('light');
                    setChoosing(r);
                  }}
                  style={{ marginTop: 6 }}
                >
                  {r.bankAccountNo ? 'Đổi nơi nhận' : 'Chọn nơi nhận tiền'}
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {choosing && <ChooseDestinationSheet key={choosing.id} refund={choosing} onClose={() => setChoosing(null)} />}
    </section>
  );
}

function ChooseDestinationSheet({ refund, onClose }: { refund: MyRefund; onClose: () => void }) {
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<RefundMethodChoice>(refund.bankAccountNo ? 'BANK' : 'WALLET');
  const [bank, setBank] = useState<RefundBankInput>(
    refund.bankAccountNo
      ? { bankName: refund.bankName ?? '', accountNumber: refund.bankAccountNo, accountName: refund.bankAccountName ?? '' }
      : EMPTY_BANK,
  );
  const [touched, setTouched] = useState(false);
  const bankError = method === 'BANK' ? bankDetailsError(bank) : null;

  const prefill = useQuery({ queryKey: ['refund-bank'], queryFn: fetchRefundBank, enabled: method === 'BANK' && !bank.accountNumber });
  useEffect(() => {
    if (prefill.data?.accountNumber) setBank((b) => (b.accountNumber ? b : prefill.data!));
  }, [prefill.data]);

  const save = useMutation({
    mutationFn: () => chooseRefundDestination(refund.id, destinationBody(method, bank)),
    onSuccess: () => {
      haptic('medium');
      void queryClient.invalidateQueries({ queryKey: ['my-refunds', refund.orderId] });
      openSnackbar({
        text: method === 'WALLET' ? `Đã hoàn ${formatVnd(refund.amount)} vào Ví Tubu.` : 'Đã lưu tài khoản. Tubu sẽ chuyển khoản trong 1-3 ngày làm việc.',
        type: 'success',
      });
      onClose();
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <BottomSheet
      open
      onClose={onClose}
      title="Nơi nhận tiền hoàn"
      description={`Đơn ${refund.orderCode}`}
      footer={
        <Button
          fullWidth
          loading={save.isPending}
          onPress={() => {
            setTouched(true);
            if (!bankError) save.mutate();
          }}
        >
          Xác nhận
        </Button>
      }
    >
      <RefundDestinationPicker
        method={method}
        onMethod={setMethod}
        bank={bank}
        onBank={setBank}
        bankError={touched ? bankError : null}
        amountLabel={formatVnd(refund.amount)}
      />
    </BottomSheet>
  );
}
