'use client';

// Nguồn: apps/miniapp/src/components/ui/section-title.tsx
import type { CSSProperties, ElementType, ReactNode } from 'react';

export interface SectionTitleProps {
  children: ReactNode;
  as?: ElementType;
  /** Tiêu đề một khối trong luồng mua (Q1): 16/700, -0.01em như `SectionHeader`. Không truyền thì là nhãn nhỏ 16/600 trong thẻ. */
  block?: boolean;
  style?: CSSProperties;
  'data-testid'?: string;
}

/** Tiêu đề một mục trong trang: Inter 16/600 (title-sm). `Heading` luôn serif (Fraunces), dành cho tiêu đề trang
 * và hero; dùng nó cho tiêu đề mục làm trang lúc serif lúc sans tuỳ mục (D7 mục 6). */
export function SectionTitle({ children, as: As = 'h2', block, style, ...rest }: SectionTitleProps) {
  return (
    <As
      style={{
        margin: 0,
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--type-title-sm-size)',
        lineHeight: 'var(--type-title-sm-lh)',
        fontWeight: block ? 700 : 'var(--type-title-sm-weight)',
        letterSpacing: block ? '-0.01em' : undefined,
        color: 'var(--color-text-primary)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </As>
  );
}
