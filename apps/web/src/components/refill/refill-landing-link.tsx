import Link from 'next/link';
import { ChevronRight, Droplets } from 'lucide-react';

/**
 * Lối vào trang Tiết kiệm với Refill do trang máy chủ quyết định (`lib/refill-entry.ts`): đích và chữ tính ở máy chủ, nên module trang Refill
 * (`refill-landing.ts`) không vào JS của trang nơi đặt link mà link vẫn nằm trong HTML đầu cho crawler.
 */
export interface RefillEntryLink {
  href: string;
  title: string;
  sub: string;
}

/**
 * Link một dòng "Tiết kiệm với Refill · Túi, can Refill rẻ hơn mua chai mới ›", CHỈ hiện từ md: Mini App không có lối này ở Danh mục khổ máy tính,
 * chi tiết sản phẩm hay trang thương hiệu, nên web khổ điện thoại giữ đúng giao diện Mini; dưới md link vẫn trong HTML (ẩn bằng CSS).
 */
export function RefillLandingLink({ entry, testId, className = '' }: { entry: RefillEntryLink; testId: string; className?: string }) {
  return (
    <Link
      href={entry.href}
      data-testid={testId}
      className={`hidden min-h-11 items-center gap-1.5 text-sm font-semibold text-[color:var(--color-text-brand)] underline-offset-2 hover:underline md:inline-flex ${className}`}
    >
      <Droplets className="h-4 w-4 flex-none" aria-hidden="true" />
      <span>{entry.title}</span>{' '}
      <span className="font-normal text-[color:var(--color-text-secondary)]">· {entry.sub}</span>
      <ChevronRight className="h-4 w-4 flex-none" aria-hidden="true" />
    </Link>
  );
}
