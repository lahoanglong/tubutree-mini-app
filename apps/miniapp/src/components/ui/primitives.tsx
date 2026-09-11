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

// ── Thẻ ────────────────────────────────────────────────────────────────────────
export interface CardProps {
  children: ReactNode;
  /** Đổ bóng nhẹ + bo góc (mặc định). `flat` cho thẻ nằm trong nền đã tách lớp. */
  variant?: 'raised' | 'flat';
  padding?: 0 | 8 | 12 | 16;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
}

/** Mặt phẳng nội dung tiêu chuẩn — thay cho bộ ba background + borderRadius + boxShadow gõ tay. */
export function Card({ children, variant = 'raised', padding = 12, onClick, className, style }: CardProps) {
  const interactive = typeof onClick === 'function';
  return (
    <Box
      // `tubu-card` đã gói sẵn nền/bo góc/bóng + hiệu ứng nhấn (css/tokens.css).
      className={[variant === 'raised' ? 'tubu-card' : '', interactive ? 'tubu-press' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      role={interactive ? 'button' : undefined}
      onClick={onClick}
      style={{
        padding,
        ...(variant === 'flat'
          ? { background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }
          : {}),
        ...style,
      }}
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

// ── Nhãn trạng thái ────────────────────────────────────────────────────────────
export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';

const BADGE_STYLE: Record<BadgeTone, { bg: string; fg: string }> = {
  success: { bg: 'var(--success-bg)', fg: 'var(--leaf-700)' },
  warning: { bg: 'var(--warning-bg)', fg: 'var(--warning)' },
  danger: { bg: 'var(--danger-bg)', fg: 'var(--danger)' },
  info: { bg: 'var(--info-bg)', fg: 'var(--info)' },
  neutral: { bg: 'var(--neutral-100)', fg: 'var(--neutral-600)' },
  brand: { bg: 'var(--primary-50)', fg: 'var(--primary-700)' },
};

/** Nhãn trạng thái nhỏ (đơn hàng, hoa hồng, kiểm duyệt...). Nền nhạt + chữ đậm cùng tông. */
export function Badge({
  children,
  tone = 'neutral',
  style,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  style?: CSSProperties;
}) {
  const c = BADGE_STYLE[tone];
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        fontSize: 11,
        fontWeight: 600,
        padding: '3px 8px',
        borderRadius: 'var(--radius-full)',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** Chip lọc/chọn — dùng cho hàng danh mục, khoảng giá, bộ lọc. */
export function Chip({
  children,
  selected,
  onClick,
  style,
}: {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  return (
    <span
      role="button"
      aria-pressed={selected}
      className="tubu-press"
      onClick={onClick}
      style={{
        background: selected ? 'var(--primary-600)' : 'var(--neutral-100)',
        color: selected ? 'var(--neutral-0)' : 'var(--neutral-700)',
        fontSize: 13,
        fontWeight: selected ? 600 : 500,
        padding: '7px 14px',
        borderRadius: 'var(--radius-full)',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// ── Tiêu đề mục ────────────────────────────────────────────────────────────────
/** Tiêu đề một mục nội dung + hành động phụ bên phải ("Xem tất cả"). */
export function SectionHeader({
  title,
  actionLabel,
  onAction,
  style,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: CSSProperties;
}) {
  return (
    <Row justify="space-between" style={{ marginBottom: 8, ...style }}>
      <Text bold className="t-h3">
        {title}
      </Text>
      {actionLabel && onAction && (
        <span role="button" className="tubu-press" onClick={onAction} style={{ color: 'var(--primary-700)', fontSize: 13, fontWeight: 600 }}>
          {actionLabel}
        </span>
      )}
    </Row>
  );
}

// ── Thanh hành động dính đáy ───────────────────────────────────────────────────
/**
 * Thanh CTA dính đáy màn hình. Tự chừa safe-area (tai thỏ/home bar) — trước đây mỗi trang tự
 * gõ `calc(16px + var(--safe-bottom))`, sót một chỗ là nút bị thanh home của máy che mất.
 */
export function StickyActionBar({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <Box
      flex
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        gap: 10,
        padding: 16,
        paddingBottom: 'calc(16px + var(--safe-bottom))',
        background: 'var(--neutral-0)',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 10,
        ...style,
      }}
    >
      {children}
    </Box>
  );
}

// ── Dòng danh sách ─────────────────────────────────────────────────────────────
/** Dòng trong danh sách cài đặt/menu: icon + tiêu đề + mô tả + phần bên phải. */
export function ListRow({
  icon,
  title,
  subtitle,
  right,
  onClick,
  style,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  return (
    <Row
      className={onClick ? 'tubu-press' : undefined}
      justify="space-between"
      style={{ padding: '12px 0', minHeight: 44, ...style }}
      {...(onClick ? { } : {})}
    >
      <Row gap={10} style={{ flex: 1, minWidth: 0 }}>
        {icon}
        <Box style={{ flex: 1, minWidth: 0 }} onClick={onClick} role={onClick ? 'button' : undefined}>
          <Text size="small" bold>
            {title}
          </Text>
          {subtitle && (
            <Txt tone="subtle" size="xSmall" style={{ marginTop: 2 }}>
              {subtitle}
            </Txt>
          )}
        </Box>
      </Row>
      {right}
    </Row>
  );
}
