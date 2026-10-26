import type { ReactNode } from 'react';
import Link from 'next/link';
import { ui } from '@/lib/guest-ui';

/**
 * Link "← Trang trước" của trang con. Mini App không có link chữ này mà dùng nút lùi tròn nổi (layout gắn một lần cho mọi trang),
 * nên ở điện thoại (< md) link ẩn; từ md giữ nguyên link chữ.
 */
export default function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} data-back-link="" className={`${ui.backLink} max-md:hidden`}>
      {children}
    </Link>
  );
}
