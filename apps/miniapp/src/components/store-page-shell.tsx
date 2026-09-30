import type { ReactNode } from 'react';
import { Heading } from './ui/text';
import { StickyActionBar } from './ui/sticky-action-bar';

export interface StorePageShellProps {
  coverUrl?: string | null;
  coverHeight: number;
  avatarUrl?: string | null;
  avatarFallback: ReactNode;
  avatarSize: number;
  title: string;
  badges?: ReactNode;
  children: ReactNode;
  stickyBar?: ReactNode;
}

/** Khung dùng chung cho gian hàng CTV (`storefront-view.tsx`) và trang nhãn (`brand-view.tsx`) —
 * chỉ phần khung THỊ GIÁC thật sự giống nhau (cover/avatar/tiêu đề/badge/lưới/CTA đáy). Logic
 * nghiệp vụ khác nhau (follow, share-to-earn, chứng nhận, khuyến mãi, đại lý...) ở LẠI từng
 * trang như `children` — xem "Plan refinement" trong Task 28 vì sao không gộp toàn bộ. */
export function StorePageShell({ coverUrl, coverHeight, avatarUrl, avatarFallback, avatarSize, title, badges, children, stickyBar }: StorePageShellProps) {
  return (
    <div style={{ background: 'var(--color-bg-canvas)', paddingBottom: stickyBar ? 'calc(90px + var(--safe-bottom))' : 24 }}>
      {/* Ngoặc kép quanh URL + mã hoá ký tự phá chuỗi (", \, xuống dòng) để URL lạ không thoát khỏi url(). */}
      <div style={{ height: coverHeight, background: coverUrl ? `url("${coverUrl.replace(/["\\\r\n]/g, encodeURIComponent)}") center/cover` : 'var(--forest-700)' }} />
      <div style={{ padding: '0 16px', marginTop: -(avatarSize / 2) }}>
        <div style={{
          width: avatarSize, height: avatarSize, borderRadius: '50%', background: 'var(--color-action-primary-bg)',
          border: '3px solid var(--color-bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
          {avatarUrl ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : avatarFallback}
        </div>
        <Heading variant="title-lg" as="h1" style={{ marginTop: 8 }}>{title}</Heading>
        {badges && <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>{badges}</div>}
      </div>
      {children}
      {stickyBar && <StickyActionBar primary={stickyBar} />}
    </div>
  );
}
