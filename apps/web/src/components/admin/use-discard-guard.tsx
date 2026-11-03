'use client';

import { useCallback, useRef, type ReactNode } from 'react';
import { useConfirm } from './confirm-dialog';

/**
 * Hỏi "Bỏ thay đổi chưa lưu?" trước khi đóng một ngăn kéo/form có bản nháp. `guard(action)` chạy `action` ngay khi chưa sửa gì,
 * còn đã sửa thì chờ admin chọn Bỏ thay đổi. `dialog` phải nằm trong JSX của component gọi.
 */
export function useDiscardGuard(dirty: boolean): { guard: (action: () => void) => void; dialog: ReactNode } {
  const { confirm, dialog } = useConfirm();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const guard = useCallback(
    (action: () => void) => {
      if (!dirtyRef.current) return action();
      void confirm({
        title: 'Bỏ thay đổi chưa lưu?',
        message: 'Những chỗ vừa sửa chưa được lưu và sẽ mất.',
        confirmLabel: 'Bỏ thay đổi',
        cancelLabel: 'Tiếp tục sửa',
        tone: 'danger',
      }).then((ok) => {
        if (ok) action();
      });
    },
    [confirm],
  );
  return { guard, dialog };
}
