'use client';

import { useRef, useState } from 'react';
import {
  COD_SWITCH_CONFIRM,
  COD_SWITCH_CONFIRM_TITLE,
  COD_SWITCH_CTA,
  COD_SWITCH_KEEP,
  codSwitchConfirmBody,
} from '@tubutree/app-core/bank-payment-copy';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { mini } from '@/components/order-mobile/mobile-ui';
import { ApiError } from '@/lib/client-api';
import { actionErrorText } from '@/lib/error-text';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';

/** Máy chủ từ chối vì đơn đã đổi trạng thái (đã trả, đã huỷ, vừa đổi ở máy khác): màn phải tải lại đơn. */
const isStale = (e: unknown) => e instanceof ApiError && [400, 404, 409].includes(e.status);

/**
 * Nút phụ "Đổi sang trả tiền khi nhận (COD)" cho đơn chuyển khoản chưa trả, qua tấm xác nhận (như CodSwitchAction của Mini App). `switchToCod`
 * là lời gọi của khách đăng nhập hay khoá theo dõi của khách vãng lai. Đổi xong: `onSettled('switched')`, trang chứa báo và tải lại hay chuyển trang;
 * máy chủ từ chối vì đơn đã đổi: hiện câu của máy chủ dưới nút và `onSettled('stale')` để trang tải lại.
 */
export function CodSwitchAction({
  total,
  switchToCod,
  onSettled,
  className = '',
}: {
  total: number;
  switchToCod: () => Promise<unknown>;
  onSettled: (result: 'switched' | 'stale') => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ref: hai cú chạm cùng khung hình chưa kịp vẽ lại thì state `busy` còn cũ.
  const pending = useRef(false);

  const confirm = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await switchToCod();
      setOpen(false);
      onSettled('switched');
    } catch (e) {
      setOpen(false);
      setError(actionErrorText(e));
      if (isStale(e)) onSettled('stale');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <div className={className} data-testid="cod-switch">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={`${ui.btnSecondary} ${mini.secondary} w-full`}
      >
        {COD_SWITCH_CTA}
      </button>
      {error && (
        <p role="alert" data-testid="cod-switch-error" className="mt-2 text-center text-sm text-danger-fg">
          {error}
        </p>
      )}
      <ConfirmSheet
        open={open}
        title={COD_SWITCH_CONFIRM_TITLE}
        message={codSwitchConfirmBody(formatVnd(total))}
        confirmLabel={COD_SWITCH_CONFIRM}
        cancelLabel={COD_SWITCH_KEEP}
        loading={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}
