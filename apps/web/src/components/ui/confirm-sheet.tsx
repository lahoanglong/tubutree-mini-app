'use client';

// Nguồn: apps/miniapp/src/components/ui/confirm-sheet.tsx (cùng props; web dựng từ Sheet)
import { useId } from 'react';
import { Button, Text } from '@/components/mini';
import { Sheet } from './sheet';

export interface ConfirmSheetProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` cho việc không hoàn tác được từ trong app (thu hồi quyền, xoá). */
  tone?: 'default' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Tấm xác nhận một bước thay cho `window.confirm`: sheet đáy ở điện thoại, hộp giữa màn hình từ md, giống ConfirmSheet của Mini App. */
export function ConfirmSheet({ open, title, message, confirmLabel, cancelLabel = 'Huỷ', tone = 'default', loading, onConfirm, onCancel }: ConfirmSheetProps) {
  const messageId = useId();
  return (
    <Sheet
      open={open}
      role="alertdialog"
      describedBy={message ? messageId : undefined}
      onClose={onCancel}
      title={title}
      dismissible={!loading}
      footer={
        <div className="flex flex-col gap-2">
          <Button fullWidth variant={tone === 'danger' ? 'danger' : 'primary'} loading={loading} onPress={onConfirm}>
            {confirmLabel}
          </Button>
          <Button fullWidth variant="secondary" disabled={loading} onPress={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      }
    >
      {message && (
        <div id={messageId}>
          <Text variant="body-sm" tone="secondary" as="p">{message}</Text>
        </div>
      )}
    </Sheet>
  );
}
