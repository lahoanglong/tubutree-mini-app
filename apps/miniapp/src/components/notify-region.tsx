import { SR_ONLY } from './ui/sr-only';
import { useAnnouncements } from '../hooks/use-notify';

/**
 * Hai vùng đọc ẩn trực quan cho `useNotify`; gắn một lần ở app.tsx cạnh SnackbarProvider.
 * Chỉ dùng `aria-live`, không `role="status"`/`role="alert"`: vùng luôn có mặt (kể cả lúc rỗng) nên mang role sẽ thành một
 * "alert"/"status" thường trực trong cây truy cập, lẫn với lỗi thật của từng màn khi tìm theo role.
 */
export function NotifyRegion() {
  const { status, alert } = useAnnouncements();
  return (
    <>
      <div aria-live="polite" aria-atomic="true" data-testid="notify-status" style={SR_ONLY}>{status}</div>
      <div aria-live="assertive" aria-atomic="true" data-testid="notify-alert" style={SR_ONLY}>{alert}</div>
    </>
  );
}
