import { SR_ONLY } from './ui/sr-only';
import { useAnnouncements } from '../hooks/use-notify';

/** Hai vùng đọc ẩn trực quan cho `useNotify`; gắn một lần ở app.tsx cạnh SnackbarProvider. */
export function NotifyRegion() {
  const { status, alert } = useAnnouncements();
  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" style={SR_ONLY}>{status}</div>
      <div role="alert" style={SR_ONLY}>{alert}</div>
    </>
  );
}
