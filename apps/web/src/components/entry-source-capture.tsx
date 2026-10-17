'use client';

import { useEffect } from 'react';
import { captureFirstTouch } from '@/lib/entry-source';

/** Bắt `?src=`/`utm_*`/`card=` ở BẤT KỲ trang nào (QR, link bio, link OA thường trỏ thẳng trang sản phẩm) và nhớ nguồn chạm đầu. */
export function EntrySourceCapture() {
  useEffect(() => {
    captureFirstTouch();
  }, []);
  return null;
}
