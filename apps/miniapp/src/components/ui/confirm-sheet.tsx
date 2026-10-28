import { BottomSheet } from './bottom-sheet';
import { Button } from './button';
import { Text } from './text';

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

/** Tấm xác nhận một bước thay cho `window.confirm`: hộp thoại gốc của trình duyệt không đúng giao diện Mini App và có nơi bị chặn. */
export function ConfirmSheet({ open, title, message, confirmLabel, cancelLabel = 'Huỷ', tone = 'default', loading, onConfirm, onCancel }: ConfirmSheetProps) {
  return (
    <BottomSheet
      open={open}
      onClose={onCancel}
      title={title}
      dismissible={!loading}
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button fullWidth variant={tone === 'danger' ? 'danger' : 'primary'} loading={loading} onPress={onConfirm}>
            {confirmLabel}
          </Button>
          <Button fullWidth variant="secondary" disabled={loading} onPress={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      }
    >
      {message && <Text variant="body-sm" tone="secondary" as="p">{message}</Text>}
    </BottomSheet>
  );
}
