import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { ui } from '@/lib/guest-ui';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Link quay lại; bỏ trống thì không có nút quay lại (trang gốc). */
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
  variant?: 'plain' | 'hero';
}

/** Tiêu đề trang con, cùng nội dung với `PageHeader` của Mini App. Luôn có đúng một h1. */
export function PageHeader({ title, subtitle, backHref, backLabel = 'Quay lại', actions, variant = 'plain' }: PageHeaderProps) {
  const hero = variant === 'hero';
  return (
    <header className={`flex items-center gap-2 ${hero ? 'rounded-card bg-forest-800 px-4 py-3' : ''}`}>
      {backHref && (
        <Link href={backHref} aria-label={backLabel} className={`${ui.backLink} -ml-2 w-11 justify-center ${hero ? 'text-stone-0' : ''}`}>
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className={`${ui.pageTitle} ${hero ? 'text-stone-0' : ''}`}>{title}</h1>
        {subtitle && <div className={`text-xs ${hero ? 'text-stone-100' : 'text-stone-600'}`}>{subtitle}</div>}
      </div>
      {actions}
    </header>
  );
}
