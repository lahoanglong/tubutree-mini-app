'use client';

import Link from 'next/link';
import type { ComponentProps, MouseEvent } from 'react';
import { useOptionalRouter } from '@/lib/optional-nav';
import { pathMatchesPrevious } from '@/lib/nav-depth';

type BackAwareLinkProps = Omit<ComponentProps<typeof Link>, 'href'> & { href: string };

/**
 * `next/link` nhưng khi đích chính là trang ngay trước trong lịch sử web thì lùi thật (`router.back()`) thay vì đẩy thêm một bản sao của trang đó:
 * Giỏ → Thanh toán → "Về giỏ hàng" không thành Giỏ → Thanh toán → Giỏ (Back sau đó không dội lại Thanh toán). Bản web của `smartNavigate` ở Mini App.
 * Bấm kèm phím meta/ctrl/shift/alt, chuột giữa, `target` mở tab khác, hay vào thẳng trang (chưa có lịch sử trong web) thì để Link đi như thường.
 */
export function BackAwareLink({ href, onClick, target, ...rest }: BackAwareLinkProps) {
  const router = useOptionalRouter();
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (target && target !== '_self') return;
    if (!pathMatchesPrevious(href)) return;
    e.preventDefault();
    if (router) router.back();
    else window.history.back();
  };
  return <Link href={href} target={target} onClick={handleClick} {...rest} />;
}
