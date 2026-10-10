import { useRef } from 'react';
import type { AriaAttributes, CSSProperties, ReactNode } from 'react';
import { Button as ZButton } from 'zmp-ui';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'flash';

const ZAUI_VARIANT: Record<ButtonVariant, 'primary' | 'secondary' | 'tertiary'> = {
  primary: 'primary', danger: 'primary', flash: 'primary', secondary: 'secondary', ghost: 'tertiary',
};

// flash uses a distinct background (terracotta) not covered by the ZaUI bridge's primary token —
// applied as an explicit inline override, same escape hatch the old Btn used for variant tones.
const FLASH_STYLE: CSSProperties = { background: 'var(--color-flash-solid-bg)', color: 'var(--color-flash-solid-fg)' };
const DANGER_STYLE: CSSProperties = { background: 'var(--color-action-danger-bg)', color: 'var(--color-action-danger-fg)' };

/** Mọi thuộc tính `aria-*` (aria-label, aria-describedby, aria-controls, aria-expanded...) đều
 * được chuyển thẳng xuống thẻ <button> thật (ZButton spread `rest`). */
export interface ButtonProps extends AriaAttributes {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  fullWidth?: boolean;
  /** Kiểu `() => void` để nhận cả handler trả giá trị bất kỳ; nếu trả Promise thì Button khoá bấm lại tới khi Promise xong.
   * Khoá chỉ thấy được Promise mà handler TRẢ VỀ: `() => submit()` được khoá, còn `() => { void submit(); }`
   * trả `undefined` nên chỉ còn prop `loading` chặn bấm lại. Handler bất đồng bộ nên trả Promise (hoặc tự giữ ref khoá). */
  onPress?: () => void;
  className?: string;
  style?: CSSProperties;
}

/** Nút thống nhất — thay 255 zmp Button + 218 nút tự chế + Btn cũ (audit A4-07). KHÔNG BAO GIỜ
 * đẩy `loading` vào `disabled` của ZaUI: đó chính là lý do 96/110 nút cũ không hiện spinner
 * (Z/esm/components/button/index.js — chỉ vẽ spinner khi loading && !disabled). `disabled` ở
 * đây CHỈ đến từ prop `disabled` tường minh của caller.
 *
 * Chặn double-tap khi đang loading vẫn PHẢI có — zmp-ui Button gọi onClick bất kể `loading`,
 * chỉ `disabled` (thuộc tính DOM) mới thật sự chặn. Thay vì bắt mọi caller tự nhớ truyền thêm
 * `disabled={cùngBiếnPending}` (và vô tình tắt luôn spinner vì loading && !disabled), guard nằm
 * NGAY TRONG Button: bỏ qua press khi loading đang true, độc lập với `disabled`. Mọi nơi gọi
 * Button đều được chặn double-tap miễn phí, spinner vẫn hiện bình thường.
 *
 * A11y khi loading (spec §5 #2 "giữ nhãn, aria-busy" — final review I1): CSS ZaUI
 * `.zaui-btn-loading>*{visibility:hidden}` ẩn nhãn, chỉ còn `span role="img"` rỗng của spinner →
 * accessible name của nút thành RỖNG. Vì vậy khi loading: `aria-busy` + `aria-disabled` (nút
 * không bị `disabled` thật — xem trên — nên phải báo cho trình đọc màn hình là đang bận/không
 * bấm được), và `aria-label` giữ nguyên nhãn: lấy từ prop `aria-label` nếu có, không thì suy
 * từ children dạng chữ/số. Children là JSX phức tạp → caller nên truyền `aria-label`. Caller truyền `aria-busy`/`aria-disabled`
 * tường minh thì thắng giá trị suy từ `loading`. */
export function Button({
  children, variant = 'primary', size = 'md', loading, disabled, icon: IconCmp, fullWidth, onPress, className, style,
  ...aria
}: ButtonProps) {
  const toneStyle = variant === 'flash' ? FLASH_STYLE : variant === 'danger' ? DANGER_STYLE : undefined;
  const inFlight = useRef(false);
  const handlePress = () => {
    // `loading` chỉ đúng sau khi caller re-render; hai cú chạm sát nhau trước đó vẫn thấy loading=false,
    // nên khoá đồng bộ bằng ref cho các onPress async. onPress đồng bộ không khoá (nút +/- phải bấm dồn được).
    if (loading || inFlight.current) return;
    const result: unknown = onPress?.();
    if (isThenable(result)) {
      inFlight.current = true;
      // Ném lại lỗi để unhandledrejection toàn cục (app.tsx) vẫn thấy đúng như trước khi có khoá.
      result.then(
        () => { inFlight.current = false; },
        (err: unknown) => { inFlight.current = false; throw err; },
      );
    }
  };
  const label = aria['aria-label'] ?? (loading ? textOf(children) : undefined);
  return (
    <ZButton
      aria-busy={loading || undefined}
      aria-disabled={loading || disabled || undefined}
      {...aria}
      aria-label={label}
      variant={ZAUI_VARIANT[variant]}
      loading={loading}
      disabled={disabled}
      fullWidth={fullWidth}
      onClick={handlePress}
      prefixIcon={IconCmp ? <Icon icon={IconCmp} size="sm" tone={variant === 'secondary' || variant === 'ghost' ? 'brand' : 'inverse'} /> : undefined}
      className={className ? `tubu-btn ${className}` : 'tubu-btn'}
      style={{ minHeight: size === 'lg' ? 48 : 44, borderRadius: 'var(--radius-control)', fontWeight: 600, ...toneStyle, ...style }}
    >
      {children}
    </ZButton>
  );
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

/** Nhãn chữ thuần của children (string/number hoặc mảng của chúng, vd `Đặt hàng · {price}`);
 * `undefined` nếu có phần tử JSX — khi đó không đoán, caller tự truyền `aria-label`. */
function textOf(node: ReactNode): string | undefined {
  const text = plainText(node)?.trim();
  return text ? text : undefined;
}
function plainText(node: ReactNode): string | undefined {
  if (node === null || node === undefined || typeof node === 'boolean') return ''; // `{cond && 'x'}`
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) {
    const parts = node.map(plainText);
    return parts.every((p) => p !== undefined) ? parts.join('') : undefined;
  }
  return undefined;
}
