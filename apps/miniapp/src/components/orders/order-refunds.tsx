import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'zmp-ui';
import { CheckCircle2, Clock, TriangleAlert } from 'lucide-react';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';
import { RefundDestinationPicker } from './refund-destination-picker';
import { chooseRefundDestination, fetchMyRefunds, fetchRefundBank } from '../../services/shop-api';
import { getErrorMessage, isStaleStateError } from '../../services/api';
import { settleWithin } from '../../utils/settle-within';
import { formatVnd } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import {
  EMPTY_BANK,
  destinationBody,
  refundStatusText,
  type MyRefund,
  type RefundBankInput,
  type RefundMethodChoice,
} from '../../utils/refund-rules';
import { bankDetailsError } from '../../utils/refund-form-rules';

const TONE_ICON = { success: CheckCircle2, warning: TriangleAlert, muted: Clock } as const;
const TONE_TEXT = { success: 'success', warning: 'warning', muted: 'secondary' } as const;

/** Khoản hoàn tiền của đơn (chuyển khoản chờ xử lý, tiền về muộn): trạng thái từng bước và nút chọn nơi nhận (D2). */
export function OrderRefunds({ orderId, returnRequestIds }: { orderId: string; returnRequestIds?: ReadonlySet<string> }) {
  const refunds = useQuery({ queryKey: ['my-refunds', orderId], queryFn: () => fetchMyRefunds(orderId) });
  const [choosing, setChoosing] = useState<MyRefund | null>(null);
  // Khoản hoàn của một yêu cầu trả hàng đã nằm cùng dòng với yêu cầu đó ở khối thao tác: không lặp lại ở đây (cùng luật với web).
  const shown = (refunds.data ?? []).filter((r) => !(r.kind === 'RETURN' && r.refKey && returnRequestIds?.has(r.refKey)));
  if (!shown.length) return null;

  return (
    <section aria-label="Hoàn tiền" style={{ background: 'var(--color-bg-surface)', padding: 16, marginTop: 8 }}>
      <Text variant="body-sm" as="div" style={{ fontWeight: 600, marginBottom: 6 }}>
        Hoàn tiền
      </Text>
      {shown.map((r) => {
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

  // Cùng khoá với danh sách ở khối cha, `enabled: false` nên chỉ đọc cache và theo dõi dữ liệu mới về, không gọi API thêm.
  const listed = useQuery({ queryKey: ['my-refunds', refund.orderId], queryFn: () => fetchMyRefunds(refund.orderId), enabled: false });

  // Điền sẵn đúng một lần (như web): bản trả về muộn chỉ điền khi cả ba ô còn trống, sau đó khách sửa hay xoá ô nào cũng không bị ghi đè.
  // Khoản hoàn đã có tài khoản: không điền sẵn, kể cả khi khách xoá sạch ba ô để nhập tài khoản khác.
  const prefillAppliedRef = useRef(Boolean(refund.bankAccountNo));
  const prefill = useQuery({ queryKey: ['refund-bank'], queryFn: fetchRefundBank, enabled: method === 'BANK' && !bank.accountNumber });
  useEffect(() => {
    const saved = prefill.data;
    if (!saved?.accountNumber || prefillAppliedRef.current) return;
    prefillAppliedRef.current = true;
    setBank((b) => (b.bankName || b.accountNumber || b.accountName ? b : saved));
  }, [prefill.data]);

  // Khoá đồng bộ: `save.isPending` chỉ đổi sau lần vẽ kế, hai cú bấm "Xác nhận" sát nhau sẽ gọi API hai lần.
  const savingRef = useRef(false);
  // Phương thức đi theo biến của mutation: khách đổi radio lúc đang lưu thì onSuccess vẫn nói đúng điều đã gửi lên máy chủ.
  const save = useMutation({
    mutationFn: (choice: RefundMethodChoice) => chooseRefundDestination(refund.id, destinationBody(choice, bank)),
    onSuccess: (_data, choice) => {
      haptic('medium');
      void queryClient.invalidateQueries({ queryKey: ['my-refunds', refund.orderId] });
      // Chỉ Ví Tubu đổi số dư; chuyển khoản chỉ ghi tài khoản để Tubu chuyển trong 1-3 ngày làm việc.
      if (choice === 'WALLET') void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      openSnackbar({
        text: choice === 'WALLET' ? `Đã hoàn ${formatVnd(refund.amount)} vào Ví Tubu.` : 'Đã lưu tài khoản. Tubu sẽ chuyển khoản trong 1-3 ngày làm việc.',
        type: 'success',
      });
      onClose();
    },
    // Khoản hoàn đã khác thẻ (máy khác vừa chọn Ví, Tubu vừa bắt đầu chuyển khoản): tải lại để thẻ và nút theo số thật, giữ khoá tới lúc đó.
    // Ví cũng tải lại vì bên thắng có thể vừa cộng tiền vào Ví. Lỗi tạm (mất mạng, 5xx) thì giữ nguyên.
    onError: (e: unknown) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      if (!isStaleStateError(e)) return undefined;
      return settleWithin(
        Promise.all([
          queryClient.invalidateQueries({ queryKey: ['my-refunds', refund.orderId] }),
          queryClient.invalidateQueries({ queryKey: ['wallet'] }),
        ]),
      );
    },
    onSettled: () => {
      savingRef.current = false;
    },
  });

  // Khoản đã sang bước khác trên máy chủ (đã đóng bằng Ví, Tubu đang chuyển khoản): sheet này không lưu được nữa nên đóng, thẻ phía sau
  // đã hiện trạng thái thật. Không đóng giữa lúc đang lưu: lệnh đang bay còn phải báo kết quả, và sau lỗi bị từ chối khoá giữ tới khi
  // dữ liệu mới về nên effect chạy lại ngay khi khoá nhả.
  const stillChoosable = listed.data?.some((r) => r.id === refund.id && r.canChooseDestination) ?? true;
  useEffect(() => {
    if (!stillChoosable && !save.isPending) onClose();
  }, [stillChoosable, save.isPending, onClose]);

  const submit = () => {
    if (savingRef.current || save.isPending) return;
    setTouched(true);
    if (bankError) return;
    savingRef.current = true;
    save.mutate(method);
  };
  const dismiss = () => {
    if (save.isPending || savingRef.current) return;
    onClose();
  };

  return (
    <BottomSheet
      open
      onClose={dismiss}
      dismissible={!save.isPending}
      title="Nơi nhận tiền hoàn"
      description={`Đơn ${refund.orderCode}`}
      footer={
        <Button fullWidth loading={save.isPending} disabled={save.isPending} onPress={submit}>
          Xác nhận
        </Button>
      }
    >
      <RefundDestinationPicker
        method={method}
        onMethod={setMethod}
        bank={bank}
        onBank={setBank}
        showBankErrors={touched}
        amountLabel={formatVnd(refund.amount)}
      />
    </BottomSheet>
  );
}
