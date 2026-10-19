'use client';

// Nguồn: apps/miniapp/src/components/ui/section-title.tsx
import type { CSSProperties, ElementType, ReactNode } from 'react';

export interface SectionTitleProps {
  children: ReactNode;
  as?: ElementType;
  style?: CSSProperties;
  'data-testid'?: string;
}

/** Tiêu đề một mục trong trang: Inter 16/600 (title-sm). `Heading` luôn serif (Fraunces), dành cho tiêu đề trang
 * và hero; dùng nó cho tiêu đề mục làm trang lúc serif lúc sans tuỳ mục (D7 mục 6). */
export function SectionTitle({ children, as: As = 'h2', style, ...rest }: SectionTitleProps) {
  return (
    <As
      style={{
        margin: 0,
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--type-title-sm-size)',
        lineHeight: 'var(--type-title-sm-lh)',
        fontWeight: 'var(--type-title-sm-weight)',
        color: 'var(--color-text-primary)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </As>
  );
}
