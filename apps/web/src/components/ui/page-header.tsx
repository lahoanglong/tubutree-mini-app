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

/**
 * Tiêu đề trang con, cùng nội dung với `PageHeader` của Mini App. Luôn có đúng một h1.
 * Dưới md vẽ như Mini App: nút lùi tròn nổi (BackButton ở layout), tiêu đề serif cỡ title-lg, dòng phụ caption, chừa 48px bên trái cho nút;
 * từ md giữ link quay lại và tiêu đề của giao diện máy tính.
 */
export function PageHeader({ title, subtitle, backHref, backLabel = 'Quay lại', actions, variant = 'plain' }: PageHeaderProps) {
  const hero = variant === 'hero';
  return (
    <header className={`flex items-center gap-2 ${hero ? 'rounded-card bg-forest-800 px-4 py-3' : ''}`}>
      {backHref && (
        <Link href={backHref} aria-label={backLabel} className={`${ui.backLink} -ml-2 w-11 justify-center max-md:hidden ${hero ? 'text-stone-0' : ''}`}>
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
      )}
      <div className={`min-w-0 flex-1 max-md:py-3 ${backHref ? 'pl-12 md:pl-0' : ''}`}>
        <h1
          className={`${ui.pageTitle} max-md:text-[length:var(--type-title-lg-size)] max-md:leading-[var(--type-title-lg-lh)] max-md:tracking-[-0.01em] ${hero ? 'text-stone-0' : ''}`}
        >
          {title}
        </h1>
        {subtitle && <div className={`text-xs max-md:text-[length:var(--type-caption-size)] max-md:leading-[var(--type-caption-lh)] ${hero ? 'text-stone-100' : 'text-stone-600'}`}>{subtitle}</div>}
      </div>
      {actions}
    </header>
  );
}
