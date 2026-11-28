import { useEffect, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { PHONE_CONFIRM_COPY as C, marketplaceChannelName } from '@tubutree/app-core/marketplace-claim-copy';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Text } from '../ui/text';

/**
 * Hộp "Xác nhận SĐT nhận hàng" (W46) của màn Quét mã, cùng chữ và cùng luồng với web `/quet-ma` (`components/points/phone-confirm-sheet.tsx`):
 * đơn sàn có SĐT người nhận khác SĐT tài khoản thì khách nhập 4 số cuối SĐT ghi trên đơn để tích điểm. Máy chủ giữ luật (3 lần sai trong 24 giờ
 * thì khoá đơn đó) và không gửi chữ số nào của SĐT trên đơn; hộp chỉ báo lại câu máy chủ trả. Sai hay khoá thì kèm lối nhắn CSKH (`onSupport`,
 * chỉ khi app có OA). `attempt` tăng mỗi lần máy chủ trả lời: ô nhập xoá và lấy lại focus để khách gõ lại ngay.
 */
export function PhoneConfirmSheet({
  open,
  channel,
  error,
  locked,
  pending,
  attempt,
  onSubmit,
  onOther,
  onClose,
  onSupport,
}: {
  open: boolean;
  channel: string | null;
  error: string | null;
  locked: boolean;
  pending: boolean;
  attempt: number;
  onSubmit: (last4: string) => void;
  /** Vắng (W59, hộp mở từ dòng lịch sử): không có nút "Quét đơn khác". */
  onOther?: () => void;
  onClose: () => void;
  onSupport?: () => void;
}) {
  const [digits, setDigits] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const name = marketplaceChannelName(channel);

  useEffect(() => {
    if (!open) return;
    setDigits('');
    setLocal(null);
    if (locked) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open, attempt, locked]);

  const submit = () => {
    if (pending || locked) return;
    if (!/^\d{4}$/.test(digits)) {
      setLocal(C.empty);
      inputRef.current?.focus();
      return;
    }
    setLocal(null);
    onSubmit(digits);
  };

  const shown = local ?? error;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={C.title}
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-xs)' }}>
          <Button fullWidth size="lg" loading={pending} disabled={locked} onPress={submit}>
            {C.submit}
          </Button>
          {onOther && (
            <Button fullWidth size="lg" variant="secondary" onPress={onOther}>
              {C.other}
            </Button>
          )}
        </div>
      }
    >
      <div data-testid="phone-confirm-sheet">
        <Input
          ref={inputRef}
          label={C.label(name)}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete="off"
          autoFocus
          enterKeyHint="done"
          placeholder={C.placeholder}
          disabled={locked}
          value={digits}
          status={shown ? 'error' : ''}
          inputClassName="tubu-nums"
          data-testid="phone-confirm-input"
          onChange={(e) => {
            setDigits(e.target.value.replace(/\D/g, '').slice(0, 4));
            if (local) setLocal(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 'var(--space-stack-xs)' }}>
          {C.note(name)}
        </Text>
        {shown && (
          <div data-testid="phone-confirm-error" style={{ marginTop: 'var(--space-stack-xs)' }}>
            <Text variant="body-sm" tone="danger" as="div">
              <span role="alert">{shown}</span>
            </Text>
            {error && !local && onSupport && (
              <Button variant="ghost" icon={MessageCircle} onPress={onSupport} style={{ marginTop: 'var(--space-stack-xs)' }}>
                {C.support}
              </Button>
            )}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
