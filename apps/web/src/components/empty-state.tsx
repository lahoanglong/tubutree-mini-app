import type { ReactNode } from 'react';
import Link from 'next/link';
import { Leaf } from 'lucide-react';

/**
 * Trạng thái rỗng của trang công khai (gian hàng, nhãn hàng chưa có sản phẩm): nói rõ vì sao trống và có lối đi tiếp,
 * thay vì để khách nhìn một trang trắng dưới phần tiêu đề.
 */
export function EmptyState({
  title,
  body,
  actionHref,
  actionLabel,
  icon,
}: {
  title: string;
  body?: string;
  actionHref: string;
  actionLabel: string;
  icon?: ReactNode;
}) {
  return (
    <section aria-label={title} className="mt-8 rounded-card border border-stone-200 bg-stone-0 p-8 text-center shadow-card">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-forest-50 text-forest-600">
        {icon ?? <Leaf className="h-6 w-6" aria-hidden="true" />}
      </div>
      <h2 className="mt-3 font-display text-base font-semibold text-stone-900">{title}</h2>
      {body && <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">{body}</p>}
      <Link
        href={actionHref}
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-control bg-forest-600 px-4 py-2 text-sm font-semibold text-stone-0 hover:bg-forest-700"
      >
        {actionLabel}
      </Link>
    </section>
  );
}
