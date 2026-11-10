'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Một việc chạy tại một thời điểm cho cả nhóm nút (chép/chia sẻ, tải lại hai khối): bấm thêm lúc đang chạy bị bỏ qua. Ref chặn hai cú bấm
 * sát nhau trước khi state kịp vẽ lại; `active` là loại việc đang chạy để nút đúng loại báo bận. Nút báo khoá bằng `aria-disabled`,
 * không dùng `disabled` thật: nút đang giữ focus mà `disabled` thì Chromium thả focus về body. Lỗi của `task` vẫn ném ra ngoài sau khi nhả khoá.
 */
export function useActionLock() {
  const lockRef = useRef(false);
  const [active, setActive] = useState<string | null>(null);
  const run = useCallback(async (kind: string, task: () => Promise<unknown>) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setActive(kind);
    try {
      await task();
    } finally {
      lockRef.current = false;
      setActive(null);
    }
  }, []);
  return { busy: active !== null, active, run };
}
