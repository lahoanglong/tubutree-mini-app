import type { CSSProperties, ElementType, ReactNode } from 'react';

export type TextVariant = 'body-lg' | 'body-md' | 'body-sm' | 'caption' | 'label' | 'price-xl' | 'price-lg' | 'price-md' | 'price-sm';
export type HeadingVariant = 'display-lg' | 'display-md' | 'title-lg' | 'title-md' | 'title-sm';
export type Tone = 'primary' | 'secondary' | 'tertiary' | 'disabled' | 'inverse' | 'brand' | 'success' | 'warning' | 'danger';

const TONE_VAR: Record<Tone, string> = {
  primary: 'var(--color-text-primary)', secondary: 'var(--color-text-secondary)',
  tertiary: 'var(--color-text-tertiary)', disabled: 'var(--color-text-disabled)',
  inverse: 'var(--color-text-inverse)', brand: 'var(--color-text-brand)',
  success: 'var(--color-text-success)', warning: 'var(--color-text-warning)', danger: 'var(--color-text-danger)',
};

function typeStyle(variant: string): CSSProperties {
  return {
    fontSize: `var(--type-${variant}-size)`,
    lineHeight: `var(--type-${variant}-lh)`,
    fontWeight: `var(--type-${variant}-weight)` as unknown as number,
  };
}

export interface TextProps {
  children: ReactNode;
  variant?: TextVariant;
  tone?: Tone;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  'data-testid'?: string;
}

/** Chữ theo vai trò (audit A4-11): 11 bậc type-* thay cho 116 fontSize literal + <Text size> của ZaUI. */
export function Text({ children, variant = 'body-md', tone = 'primary', as: As = 'span', className, style, ...rest }: TextProps) {
  return (
    <As
      className={className}
      style={{ fontFamily: 'var(--font-ui)', color: TONE_VAR[tone], margin: 0, ...typeStyle(variant), ...style }}
      {...rest}
    >
      {children}
    </As>
  );
}

const HEADING_TAG: Record<HeadingVariant, ElementType> = {
  'display-lg': 'h1', 'display-md': 'h1', 'title-lg': 'h1', 'title-md': 'h2', 'title-sm': 'h3',
};

export interface HeadingProps {
  children: ReactNode;
  variant: HeadingVariant;
  as?: ElementType;
  tone?: Tone;
  className?: string;
  style?: CSSProperties;
  'data-testid'?: string;
}

/** Render đúng h1-h3 thật (ZaUI Text.Title render <span> — 0 heading thật trong toàn app, audit A4-23). */
export function Heading({ children, variant, as, tone = 'primary', className, style, ...rest }: HeadingProps) {
  const As = as ?? HEADING_TAG[variant];
  return (
    <As
      className={className}
      style={{ fontFamily: 'var(--font-display)', color: TONE_VAR[tone], margin: 0, letterSpacing: '-0.01em', ...typeStyle(variant), ...style }}
      {...rest}
    >
      {children}
    </As>
  );
}
