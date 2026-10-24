'use client';

import { useEffect } from 'react';
import { startErrorReporting } from '@/lib/error-report';

/** Sau hydrate, lúc trình duyệt rảnh, mới nạp SDK lỗi: không chen vào đường tải đầu của khách. */
export function ErrorReporter() {
  useEffect(() => {
    const idle = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (idle) idle(startErrorReporting);
    else setTimeout(startErrorReporting, 2000);
  }, []);
  return null;
}
