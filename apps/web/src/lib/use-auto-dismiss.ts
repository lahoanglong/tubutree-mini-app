'use client';

import { useCallback, useEffect, useRef, useState, type FocusEvent } from 'react';

/**
 * Thông báo tự tắt sau `ms`, nhưng tạm dừng đồng hồ khi con trỏ đang ở trên hoặc focus đang ở trong thông báo (WCAG 2.2.1):
 * người dùng bàn phím/đọc màn hình cần thời gian tới nút "Hoàn tác". Rời đi thì đếm lại đủ `ms`. `resetKey` đổi (thông báo mới) cũng đếm lại.
 * Trả về các prop rải lên phần tử thông báo.
 */
export function useAutoDismiss(active: boolean, ms: number, onDismiss: () => void, resetKey?: unknown) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const held = hover || focus;

  useEffect(() => {
    if (!active) {
      // Phần tử gỡ khỏi cây không bắn mouseleave/blur: xoá cờ để thông báo sau không bị treo.
      setHover(false);
      setFocus(false);
      return;
    }
    if (held) return;
    const t = setTimeout(() => dismiss.current(), ms);
    return () => clearTimeout(t);
  }, [active, held, ms, resetKey]);

  const onBlur = useCallback((e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
  }, []);
  return {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onFocus: () => setFocus(true),
    onBlur,
  };
}
