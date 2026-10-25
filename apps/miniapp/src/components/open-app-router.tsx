import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { events, EventName } from 'zmp-sdk/apis';

/** Zalo trả đường dẫn đầy đủ gồm tiền tố `/zapps/<appId>`; router của app đã có basename đó nên phải bỏ đi. */
export function routerPathFromOpenApp(path: unknown): string | null {
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) return null;
  const stripped = trimmed.replace(/^\/zapps\/[^/?#]+/, '');
  return stripped.startsWith('/') ? stripped : `/${stripped}`;
}

/**
 * App đang chạy nền mà khách quét thẻ hay bấm link lần nữa: Zalo không nạp lại trang mà chỉ phát OpenApp kèm đường dẫn mới,
 * nên phải tự chuyển màn. Phải nằm trong `<ZMPRouter>`.
 */
export function OpenAppRouter() {
  const navigate = useNavigate();
  useEffect(() => {
    const onOpen = (data?: { path?: unknown }) => {
      const to = routerPathFromOpenApp(data?.path);
      if (to) navigate(to);
    };
    try {
      events.on(EventName.OpenApp, onOpen);
    } catch {
      return undefined;
    }
    return () => {
      try {
        events.off(EventName.OpenApp, onOpen);
      } catch {
        /* ngoài Zalo: không có gì để gỡ */
      }
    };
  }, [navigate]);
  return null;
}
