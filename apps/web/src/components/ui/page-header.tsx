'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { ui } from '@/lib/guest-ui';
import { useOptionalPathname } from '@/lib/optional-nav';
import { isWebRootPath } from '@/lib/web-nav';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Link quay lại cho máy tính, đồng thời là trang cha của nút lùi nổi khi khách vào thẳng link; bỏ trống thì nút lùi tự suy ra trang cha. */
  backHref?: string;
  backLabel?: string;
  /** Trang cha cho nút lùi nổi khi desktop có link riêng ngoài header (BackLink "← ..."); không vẽ gì. */
  parentHref?: string;
  actions?: ReactNode;
  variant?: 'plain' | 'hero';
  className?: string;
  subtitleClassName?: string;
}

/**
 * Tiêu đề trang con, cùng nội dung với `PageHeader` của Mini App. Luôn có đúng một h1.
 * Dưới md vẽ như Mini App: dải nền surface tràn ngang mọi cha, đệm 12/16 cộng safe-top, tiêu đề serif title-lg, dòng phụ caption tertiary,
 * chừa 48px bên trái cho nút lùi nổi (BackButton ở layout) trừ ở trang gốc của thanh đáy nơi nút ẩn.
 * `data-page-bleed` bỏ đệm 48px của body vì dải đã nằm dưới nút. Từ md giữ link quay lại và tiêu đề của giao diện máy tính.
 */
export function PageHeader({ title, subtitle, backHref, backLabel = 'Quay lại', parentHref, actions, variant = 'plain', className = '', subtitleClassName = '' }: PageHeaderProps) {
  const hero = variant === 'hero';
  const floatingBack = !isWebRootPath(useOptionalPathname());
  return (
    <header
      data-page-bleed
      data-back-href={backHref ?? parentHref}
      className={`flex items-center gap-2 max-md:mx-[calc(50%-50vw)] max-md:px-4 max-md:pb-3 max-md:pt-[calc(12px+var(--safe-top))] ${
        hero
          ? 'max-md:bg-[var(--color-bg-inverse)] md:rounded-card md:bg-forest-800 md:px-4 md:py-3'
          : 'max-md:bg-[var(--color-bg-surface)]'
      } ${className}`}
    >
      {backHref && (
        <Link href={backHref} aria-label={backLabel} className={`${ui.backLink} -ml-2 w-11 justify-center max-md:hidden ${hero ? 'text-stone-0' : ''}`}>
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
      )}
      <div className={`min-w-0 flex-1 ${floatingBack ? 'max-md:pl-12' : ''}`}>
        <h1
          className={`${ui.pageTitle} max-md:text-[length:var(--type-title-lg-size)] max-md:leading-[var(--type-title-lg-lh)] max-md:tracking-[-0.01em] ${
            hero ? 'text-stone-0 max-md:text-[color:var(--color-text-inverse)]' : ''
          }`}
        >
          {title}
        </h1>
        {subtitle && (
          <div
            className={`text-xs max-md:text-[length:var(--type-caption-size)] max-md:leading-[var(--type-caption-lh)] ${
              hero ? 'text-stone-100 max-md:text-[color:var(--color-text-inverse)]' : 'text-stone-600 max-md:text-[color:var(--color-text-tertiary)]'
            } ${subtitleClassName}`}
          >
            {subtitle}
          </div>
        )}
      </div>
      {actions}
    </header>
  );
}
