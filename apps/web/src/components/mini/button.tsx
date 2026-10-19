'use client';

// Nguồn: apps/miniapp/src/components/ui/button.tsx (zmp-ui Button thay bằng DOM cùng lớp zaui-btn*, CSS ở mini.css)
import { useRef } from 'react';
import type { AriaAttributes, CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'flash';

const ZAUI_VARIANT: Record<ButtonVariant, 'primary' | 'secondary' | 'tertiary'> = {
  primary: 'primary', danger: 'primary', flash: 'primary', secondary: 'secondary', ghost: 'tertiary',
};

const FLASH_STYLE: CSSProperties = { background: 'var(--color-flash-solid-bg)', color: 'var(--color-flash-solid-fg)' };
const DANGER_STYLE: CSSProperties = { background: 'var(--color-action-danger-bg)', color: 'var(--color-action-danger-fg)' };

export interface ButtonProps extends AriaAttributes {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  fullWidth?: boolean;
  /** Trả Promise thì nút khoá bấm lại tới khi Promise xong (như Mini App); trả `undefined` thì chỉ `loading` chặn bấm lại. */
  onPress?: () => void;
  /** Mặc định "button" để nút trong <form> không tự gửi form. */
  type?: 'button' | 'submit';
  className?: string;
  style?: CSSProperties;
}

/** Nút thống nhất. `loading` KHÔNG đẩy vào `disabled` (spinner chỉ vẽ khi loading && !disabled); khi loading nút giữ
 * nhãn truy cập (`aria-label` hoặc chữ thuần của children) cùng `aria-busy`/`aria-disabled` vì CSS ẩn nhãn hiện. */
export function Button({
  children, variant = 'primary', size = 'md', loading, disabled, icon: IconCmp, fullWidth, onPress, type = 'button', className, style,
  ...aria
}: ButtonProps) {
  const toneStyle = variant === 'flash' ? FLASH_STYLE : variant === 'danger' && !disabled ? DANGER_STYLE : undefined;
  const inFlight = useRef(false);
  const handlePress = () => {
    // `loading` chỉ đúng sau khi caller render lại; hai cú chạm sát nhau vẫn thấy loading=false nên khoá đồng bộ bằng ref.
    if (loading || inFlight.current) return;
    const result: unknown = onPress?.();
    if (isThenable(result)) {
      inFlight.current = true;
      result.then(
        () => { inFlight.current = false; },
        (err: unknown) => { inFlight.current = false; throw err; },
      );
    }
  };
  const label = aria['aria-label'] ?? (loading ? textOf(children) : undefined);
  const zVariant = ZAUI_VARIANT[variant];
  const cls = [
    'zaui-btn',
    `zaui-btn-${zVariant}`,
    disabled && 'zaui-btn-disabled',
    loading && !disabled && 'zaui-btn-loading',
    IconCmp && 'zaui-btn-prefix-icon',
    fullWidth && 'zaui-btn-full-width',
    'tubu-btn',
    className,
  ].filter(Boolean).join(' ');
  return (
    <button
      aria-busy={loading || undefined}
      aria-disabled={loading || disabled || undefined}
      {...aria}
      aria-label={label}
      type={type}
      disabled={disabled}
      onClick={handlePress}
      className={cls}
      style={{ minHeight: size === 'lg' ? 48 : 44, borderRadius: 'var(--radius-control)', fontWeight: 600, ...toneStyle, ...style }}
    >
      <div className="zaui-btn-container">
        {loading && !disabled && (
          <span className="zaui-btn-loading-container">
            <span role="img" className="zaui-btn-loading-icon"><LoadingIcon /></span>
          </span>
        )}
        {IconCmp && (
          <span className="zaui-btn-icon">
            <Icon icon={IconCmp} size="sm" tone={variant === 'secondary' || variant === 'ghost' ? 'brand' : 'inverse'} />
          </span>
        )}
        <span>{children}</span>
      </div>
    </button>
  );
}

function LoadingIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M24 12C24 18.6274 18.6274 24 12 24C5.37258 24 0 18.6274 0 12C0 5.37258 5.37258 0 12 0C18.6274 0 24 5.37258 24 12ZM2.49 12C2.49 17.2522 6.74777 21.51 12 21.51C17.2522 21.51 21.51 17.2522 21.51 12C21.51 6.74777 17.2522 2.49 12 2.49C6.74777 2.49 2.49 6.74777 2.49 12Z"
        fill="black"
        fillOpacity="0.1"
      />
      <path
        d="M15.6784 1.89361C15.9136 1.24748 16.6317 0.908557 17.25 1.20938C18.2892 1.71497 19.2519 2.369 20.1071 3.15267C21.2689 4.21731 22.2097 5.50037 22.8757 6.92858C23.5417 8.3568 23.9198 9.90221 23.9886 11.4766C24.0392 12.6355 23.9214 13.7933 23.6407 14.9143C23.4737 15.5814 22.7525 15.9136 22.1064 15.6784C21.4603 15.4433 21.1358 14.7295 21.2846 14.0582C21.4641 13.2486 21.5373 12.4172 21.5009 11.5852C21.4465 10.3375 21.1468 9.11276 20.619 7.9809C20.0912 6.84904 19.3456 5.83222 18.4249 4.98849C17.8108 4.42584 17.1269 3.94752 16.3914 3.5646C15.7815 3.24709 15.4433 2.53973 15.6784 1.89361Z"
        fill="currentColor"
      />
    </svg>
  );
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

function textOf(node: ReactNode): string | undefined {
  const text = plainText(node)?.trim();
  return text ? text : undefined;
}
function plainText(node: ReactNode): string | undefined {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) {
    const parts = node.map(plainText);
    return parts.every((p) => p !== undefined) ? parts.join('') : undefined;
  }
  return undefined;
}
