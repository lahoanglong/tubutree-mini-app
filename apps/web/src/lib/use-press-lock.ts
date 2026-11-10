'use client';

import { useRef, useState } from 'react';
import { isThenable } from '@/components/mini/button';

/**
 * Khoá chạm đúp cho nút thường (không dùng `Button` của mini): xử lý trả Promise thì khoá chạm lại tới khi xong (`Button` của Mini làm đúng vậy), trả void thì không khoá. Ref chặn cú chạm thứ hai trong cùng khung hình
 * (state chỉ đúng sau lần vẽ kế); state chỉ để báo aria-busy. Promise bị từ chối thì nhả khoá để nút không chết rồi ném lại đúng lỗi đó (như `Button`), để nó vẫn lên `unhandledrejection` và tới Sentry thay vì bị nuốt.
 */
export function usePressLock(handler?: () => void | PromiseLike<unknown>) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const press = () => {
    if (inFlight.current) return;
    const result = handler?.();
    if (!isThenable(result)) return;
    inFlight.current = true;
    setBusy(true);
    const release = () => {
      inFlight.current = false;
      setBusy(false);
    };
    result.then(release, (err: unknown) => {
      release();
      throw err;
    });
  };
  return { press, busy };
}
