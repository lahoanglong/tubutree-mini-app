import type { ReactNode } from 'react';
import Link from 'next/link';
import { ui } from '@/lib/guest-ui';
import BackButton from '@/components/mini/back-button';

/**
 * Link "← Trang trước" của trang con. Mini App không có link chữ này mà dùng nút lùi tròn nổi, nên ở điện thoại (< md)
 * link ẩn và nút nổi thế chỗ; từ md giữ nguyên link chữ.
 */
export default function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <>
      <Link href={href} className={`${ui.backLink} max-md:hidden`}>
        {children}
      </Link>
      <BackButton fallbackHref={href} className="h-11 md:!hidden" />
    </>
  );
}
