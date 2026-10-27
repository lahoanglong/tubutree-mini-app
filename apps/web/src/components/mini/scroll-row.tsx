'use client';

// Nguồn: apps/miniapp/src/components/ui/scroll-row.tsx
import type { CSSProperties, ReactNode } from 'react';
import { RailArrows } from '@/components/scroll-rail';
import { useScrollHints } from './use-scroll-hints';

export interface ScrollRowProps {
  /** Tên vùng cho trình đọc màn hình, vd "Dải thương hiệu". */
  label: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  'data-testid'?: string;
  /** Nút ‹ › từ md cho hàng thẻ sản phẩm (chuột không vuốt ngang được). Bật thì hàng được bọc thêm một khung relative. */
  arrows?: boolean;
}

/**
 * Hàng cuộn ngang dùng chung (chip, thẻ…): vùng có tên (`region`), tự focus được khi tràn mà không có
 * gì bấm được bên trong, và mờ mép phía còn nội dung để người dùng biết còn thẻ ngoài tầm nhìn
 * (audit A4-029). Đệm dọc của hàng chip phải ≥ 4px để vùng chạm 44px của Chip không bị overflow cắt.
 */
export function ScrollRow({ label, children, className, style, arrows = false, ...rest }: ScrollRowProps) {
  const hints = useScrollHints<HTMLDivElement>();
  const row = (
    <div
      {...hints}
      role="region"
      aria-label={label}
      className={['scroll-x', 'tubu-scroll-fade', className].filter(Boolean).join(' ')}
      style={style}
      {...rest}
    >
      {children}
    </div>
  );
  if (!arrows) return row;
  return (
    <div className="relative">
      {row}
      <RailArrows scrollerRef={hints.ref} hasPrev={hints['data-fade-start'] === 'true'} hasNext={hints['data-fade-end'] === 'true'} />
    </div>
  );
}
