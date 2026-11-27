'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { tubuZaloUrl } from '@tubutree/app-core/order-zalo';
import { PHONE_CONFIRM_COPY as C, marketplaceChannelName } from '@tubutree/app-core/marketplace-claim-copy';
import { BottomSheet } from '@/components/mini/bottom-sheet';
import { Button } from '@/components/mini/button';
import { Text } from '@/components/mini/text';
import { ui } from '@/lib/guest-ui';
import { zaloOaChatUrl } from '@/lib/platform-bridge';
import { usePublicConfig } from '@/lib/use-public-config';

/**
 * Hộp "Xác nhận SĐT nhận hàng" (W46) của web `/quet-ma`, cùng chữ và cùng luồng với Mini App: đơn sàn có SĐT người nhận khác SĐT tài khoản thì
 * khách nhập 4 số cuối SĐT ghi trên đơn để tích điểm. Máy chủ giữ luật (3 lần sai trong 24 giờ thì khoá đơn đó) và không bao giờ gửi chữ số
 * nào của SĐT trên đơn; hộp chỉ báo lại câu máy chủ trả. Sai hay khoá thì kèm lối nhắn CSKH. `attempt` tăng mỗi lần máy chủ trả lời: ô nhập xoá
 * và lấy lại focus để khách gõ lại ngay.
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
}: {
  open: boolean;
  channel: string | null;
  error: string | null;
  locked: boolean;
  pending: boolean;
  attempt: number;
  onSubmit: (last4: string) => void;
  onOther: () => void;
  onClose: () => void;
}) {
  const uid = useId();
  const zaloPhone = usePublicConfig().tubuZaloPhone;
  const supportHref = zaloOaChatUrl() ?? tubuZaloUrl(zaloPhone);
  const [digits, setDigits] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const name = marketplaceChannelName(channel);

  useEffect(() => {
    if (!open) return;
    setDigits('');
    setLocal(null);
    if (locked) return;
    // Sheet tự đưa focus vào phần tử đầu (nút đóng); ô 4 số mới là chỗ khách cần gõ.
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
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
  const inputId = `${uid}-last4`;
  const errorId = `${uid}-error`;
  return (
    <BottomSheet open={open} onClose={onClose} title={C.title}>
      <form
        noValidate
        data-testid="phone-confirm-sheet"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor={inputId} className="block text-sm font-semibold text-stone-900">
          {C.label(name)}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete="off"
          autoFocus
          enterKeyHint="done"
          placeholder={C.placeholder}
          disabled={locked}
          value={digits}
          aria-invalid={shown ? true : undefined}
          aria-describedby={shown ? errorId : undefined}
          onChange={(e) => {
            setDigits(e.target.value.replace(/\D/g, '').slice(0, 4));
            if (local) setLocal(null);
          }}
          data-testid="phone-confirm-input"
          className={`${shown ? ui.fieldError : ui.field} mt-2 text-center tabular-nums tracking-widest`}
        />
        <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 'var(--space-stack-xs)' }}>
          {C.note(name)}
        </Text>
        {shown && (
          <div className="mt-2" data-testid="phone-confirm-error">
            <p id={errorId} role="alert" className={ui.error}>
              {shown}
            </p>
            {error && !local && (
              <a
                href={supportHref}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="phone-confirm-support"
                className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-forest-700 underline underline-offset-2"
              >
                <MessageSquare size={16} aria-hidden="true" />
                {C.support}
              </a>
            )}
          </div>
        )}
        <div className="mt-3 flex flex-col gap-2">
          <Button type="submit" fullWidth size="lg" loading={pending} disabled={locked}>
            {C.submit}
          </Button>
          <Button fullWidth size="lg" variant="secondary" onPress={onOther}>
            {C.other}
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}
