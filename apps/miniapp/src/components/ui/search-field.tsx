import { forwardRef } from 'react';
import { Search, X } from 'lucide-react';
import { Icon } from './icon';
import { IconButton } from './icon-button';

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Enter / nút "Tìm" của bàn phím. */
  onSubmit: (value: string) => void;
  onFocus?: () => void;
  /** Mặc định: onChange(''). */
  onClear?: () => void;
  label: string;
  clearLabel: string;
  placeholder: string;
}

/**
 * Ô tìm kiếm DS v2 — DS chưa có ô nhập chữ nào (plan 4b Ruling 13). `<form role="search">` để
 * bàn phím di động hiện nút "Tìm" và Enter gửi đúng một lần; khung cao ≥ 44px; nút xoá là
 * IconButton (vùng chạm 44px, có nhãn).
 */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onChange, onSubmit, onFocus, onClear, label, clearLabel, placeholder },
  ref,
) {
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
      style={{ flex: 1, minWidth: 0 }}
    >
      <div
        data-testid="search-field-box"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minHeight: 44,
          padding: '0 2px 0 14px',
          borderRadius: 'var(--radius-pill)',
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-subtle)',
          boxSizing: 'border-box',
        }}
      >
        <Icon icon={Search} size="sm" tone="muted" />
        <input
          ref={ref}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          style={{
            flex: 1,
            minWidth: 0,
            height: 42,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--type-body-md-size)',
            color: 'var(--color-text-primary)',
          }}
        />
        {value !== '' && <IconButton icon={X} size="sm" label={clearLabel} onPress={() => (onClear ? onClear() : onChange(''))} />}
      </div>
    </form>
  );
});
