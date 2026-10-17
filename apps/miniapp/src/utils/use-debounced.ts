import { useEffect, useState } from 'react';

/** Chờ lựa chọn/số lượng giỏ đứng yên rồi mới hỏi lại giá/mức giảm, để bấm liên tục không chạm giới hạn 30 lần/phút của API. */
export const PREVIEW_DEBOUNCE_MS = 300;

/** Debounce giá trị — dùng cho ô tìm kiếm để không spam API mỗi phím gõ. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
