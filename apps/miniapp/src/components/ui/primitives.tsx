/**
 * Bộ primitive UI dùng chung.
 *
 * Vì sao cần: audit đầu phiên đếm được **2.049 object `style={{}}`** rải trên 41 trang, trong
 * đó lặp lại nhiều nhất là mấy thứ đáng lẽ phải có tên: `color: var(--neutral-400)` (167 lần),
 * `background: var(--neutral-0) + borderRadius` (thẻ), `gap` (409 lần), và
 * `paddingBottom: calc(16px + var(--safe-bottom))` (thanh hành động dính đáy). Mỗi lần gõ tay
 * là một cơ hội lệch: chỗ dùng `--neutral-400`, chỗ `--neutral-500` cho cùng vai trò "chữ phụ".
 *
 * Nguyên tắc:
 * - KHÔNG có giá trị thị giác thô ở đây (hex/px lẻ) — mọi thứ trỏ về token trong `css/tokens.css`.
 * - Bọc `zmp-ui` chứ không thay thế: giữ hành vi/nhịp chạm của ZaUI, chỉ chuẩn hoá lớp áo.
 * - Nhận `style` để trang vẫn tinh chỉnh được ca lẻ, không bắt phải "thoát" khỏi primitive.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Box, Button as ZButton, Text } from 'zmp-ui';

// ── Chữ ────────────────────────────────────────────────────────────────────────
/** Vai trò của chữ — đặt tên theo Ý NGHĨA, không theo màu, để đổi palette không phải sửa trang. */
export type TextTone = 'default' | 'muted' | 'subtle' | 'brand' | 'leaf' | 'danger' | 'warning' | 'onDark';

const TONE_COLOR: Record<TextTone, string> = {
  default: 'var(--neutral-900)',
  muted: 'var(--neutral-600)', // chữ phụ đọc được (mô tả, chú thích có nội dung)
  subtle: 'var(--neutral-400)', // chữ mờ nhất (timestamp, đơn vị, gợi ý)
  brand: 'var(--primary-700)',
  leaf: 'var(--leaf-700)',
  danger: 'var(--danger)',
  warning: 'var(--warning)',
  onDark: 'var(--neutral-0)',
};

export interface TxtProps {
  children: ReactNode;
  tone?: TextTone;
  size?: 'xSmall' | 'small' | 'normal' | 'large' | 'xLarge';
  bold?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Chữ có vai trò rõ ràng. Thay cho `<Text style={{ color: 'var(--neutral-400)' }}>` rải khắp nơi. */
export function Txt({ children, tone = 'default', size = 'normal', bold, className, style }: TxtProps) {
  return (
    <Text size={size} bold={bold} className={className} style={{ color: TONE_COLOR[tone], ...style }}>
      {children}
    </Text>
  );
}

// ── Bố cục ─────────────────────────────────────────────────────────────────────
type Gap = 0 | 2 | 4 | 6 | 8 | 10 | 12 | 16 | 20 | 24;

export interface StackProps {
  children: ReactNode;
  gap?: Gap;
  align?: CSSProperties['alignItems'];
  justify?: CSSProperties['justifyContent'];
  className?: string;
  style?: CSSProperties;
}

/** Cột dọc có khoảng cách chuẩn. */
export function Stack({ children, gap = 8, align, justify, className, style }: StackProps) {
  return (
    <Box
      flex
      flexDirection="column"
      className={className}
      style={{ gap, alignItems: align, justifyContent: justify, ...style }}
    >
      {children}
    </Box>
  );
}

/** Hàng ngang có khoảng cách chuẩn; `wrap` cho nhóm chip/tag. */
export function Row({
  children,
  gap = 8,
  align = 'center',
  justify,
  wrap,
  className,
  style,
}: StackProps & { wrap?: boolean }) {
  return (
    <Box
      flex
      className={className}
      style={{ gap, alignItems: align, justifyContent: justify, flexWrap: wrap ? 'wrap' : undefined, ...style }}
    >
      {children}
    </Box>
  );
}

// ── Nút ────────────────────────────────────────────────────────────────────────
export type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface BtnProps {
  children: ReactNode;
  variant?: BtnVariant;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  /** Nút chính trong thanh hành động cần cao hơn cho dễ chạm. */
  size?: 'small' | 'medium' | 'large';
  prefixIcon?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

const BTN_HEIGHT: Record<NonNullable<BtnProps['size']>, number> = { small: 36, medium: 44, large: 48 };

/**
 * Nút thống nhất. Chiều cao tối thiểu luôn ≥ 36px (small) và mặc định 44px — đúng ngưỡng vùng
 * chạm khuyến nghị, thay vì mỗi trang tự đặt `minHeight` khác nhau.
 */
export function Btn({
  children,
  variant = 'primary',
  onClick,
  disabled,
  loading,
  fullWidth,
  size = 'medium',
  prefixIcon,
  className,
  style,
}: BtnProps) {
  const tone: CSSProperties =
    variant === 'primary'
      ? { background: 'var(--primary-600)', color: 'var(--neutral-0)', fontWeight: 700 }
      : variant === 'danger'
        ? { background: 'var(--danger)', color: 'var(--neutral-0)', fontWeight: 700 }
        : variant === 'ghost'
          ? { background: 'transparent', color: 'var(--primary-700)', fontWeight: 600 }
          : { color: 'var(--primary-700)', borderColor: 'var(--primary-200)', fontWeight: 600 };

  return (
    <ZButton
      variant={variant === 'primary' || variant === 'danger' ? 'primary' : 'secondary'}
      size={size === 'large' ? 'medium' : size}
      fullWidth={fullWidth}
      disabled={disabled || loading}
      loading={loading}
      onClick={onClick}
      prefixIcon={prefixIcon}
      className={className}
      style={{ minHeight: BTN_HEIGHT[size], ...tone, ...style }}
    >
      {children}
    </ZButton>
  );
}
