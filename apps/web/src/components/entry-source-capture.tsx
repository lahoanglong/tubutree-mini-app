'use client';

import { useEffect } from 'react';
import { captureFirstTouch } from '@/lib/entry-source';
import { reportLinkClick } from '@/lib/link-click';

/**
 * Bắt `?src=`/`utm_*`/`card=` ở BẤT KỲ trang nào (QR, link bio, link OA thường trỏ thẳng trang sản phẩm) và nhớ nguồn chạm đầu;
 * link CTV có `?l=` thì báo một click.
 */
export function EntrySourceCapture() {
  useEffect(() => {
    captureFirstTouch();
    reportLinkClick(window.location.search);
  }, []);
  return null;
}
