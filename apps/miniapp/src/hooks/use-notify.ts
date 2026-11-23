import { useCallback } from 'react';
import { useSnackbar } from 'zmp-ui';
import { announce, announceKind } from '../lib/announce';

export type NotifyType = 'success' | 'info' | 'warning' | 'error';
export interface NotifyOptions {
  text: string;
  type?: NotifyType;
  duration?: number;
  position?: 'top' | 'bottom';
}

export { announce, spokenText, useAnnouncements } from '../lib/announce';

/**
 * Thông báo cho cả mắt và tai: hiện snackbar của ZaUI (không có aria-live, nên người dùng VoiceOver/TalkBack không nghe gì) và
 * đồng thời ghi vào vùng đọc. Lỗi/cảnh báo vào vùng assertive, còn lại vào vùng polite.
 */
export function useNotify(): { notify: (opts: NotifyOptions) => void } {
  const { openSnackbar } = useSnackbar();
  const notify = useCallback(
    ({ text, type, duration, position }: NotifyOptions) => {
      // Chỉ chuyển khoá được truyền: openSnackbar không nhận `undefined` như "chưa đặt".
      openSnackbar({
        text,
        ...(type ? { type } : null),
        ...(duration !== undefined ? { duration } : null),
        ...(position ? { position } : null),
      });
      announce(announceKind(type), text);
    },
    [openSnackbar],
  );
  return { notify };
}
