import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { ui } from '@/lib/guest-ui';

export interface ListingLayoutProps {
  /** `ListingBreadcrumb`; chỉ hiện từ md. */
  breadcrumb?: ReactNode;
  /** Chữ của h1. Ở điện thoại h1 chỉ dành cho trình đọc màn hình (Mini App không có tiêu đề trang), từ md hiện ra. */
  title: ReactNode;
  caption?: ReactNode;
  /** Nằm giữa tiêu đề và nội dung, ngoài cột lọc: ô tìm của trang Danh mục. */
  toolbar?: ReactNode;
  /** Cột lọc bên trái từ lg. Tự ẩn dưới lg (phần tử này tự mang `hidden lg:block`); thiếu thì không có cột. */
  sidebar?: ReactNode;
  children: ReactNode;
}

/**
 * Khung trang danh sách trên máy tính: breadcrumb, h1, rồi lưới cột lọc 200px + nội dung từ lg. Cột lọc là phần tử thường: KHÔNG dính,
 * KHÔNG giới hạn chiều cao, KHÔNG cuộn riêng (cả trang cuộn một lần; cột dính là lỗi hay gặp khi cột dài hơn màn hình). Dưới lg không có
 * cột, nội dung chạy nguyên khổ điện thoại như Mini App.
 */
export function ListingLayout({ breadcrumb, title, caption, toolbar, sidebar, children }: ListingLayoutProps) {
  return (
    <div>
      {breadcrumb}
      <h1 className={`${ui.pageTitle} mb-1 max-md:sr-only md:mb-3`}>{title}</h1>
      {caption && <p className="mb-3 text-sm text-stone-600 max-md:hidden">{caption}</p>}
      {toolbar}
      {sidebar ? (
        <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start lg:gap-6">
          {sidebar}
          <div className="min-w-0">{children}</div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export interface BreadcrumbItem {
  label: string;
  /** Thiếu = mục hiện tại (không liên kết). */
  href?: string;
}

/** Vết đường dẫn "Trang chủ › Danh mục › …": ẩn ở điện thoại (Mini App không có), mục cuối là trang hiện tại. */
export function ListingBreadcrumb({ trail }: { trail: BreadcrumbItem[] }) {
  if (trail.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-2 hidden md:block">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-stone-600">
        {trail.map((item, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={`${i}:${item.label}`} className="flex min-w-0 items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href} className="inline-flex min-h-8 items-center hover:text-forest-700 hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={last ? 'font-medium text-stone-900' : undefined}>
                  {item.label}
                </span>
              )}
              {!last && <ChevronRight className="h-4 w-4 flex-none text-stone-400" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
