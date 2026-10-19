import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

/** Hàng liên kết có mũi tên, thay `ListRow` của Mini App: cả hàng là một link, vùng chạm tối thiểu 44px. */
export function RecycleLinkRow({ href, title, subtitle, children }: { href: string; title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <Link href={href} className="flex min-h-11 items-center gap-3 px-4 py-3 hover:bg-stone-50">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-stone-900">{title}</span>
        {subtitle && <span className="block text-xs text-stone-600">{subtitle}</span>}
        {children}
      </span>
      <ChevronRight className="h-4 w-4 flex-none text-stone-500" aria-hidden="true" />
    </Link>
  );
}
