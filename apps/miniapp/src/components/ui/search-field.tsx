import { forwardRef, useImperativeHandle, useRef } from 'react';
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
 *
 * Chi tiết bàn phím/IME: nút xoá trả focus về ô nhập (bàn phím không đóng giữa chừng); Enter đúng lúc
 * bộ gõ đang ghép chữ (isComposing, hoặc keyCode 229 — Safari/WKWebView bắn Enter sau compositionend)
 * bị chặn nên form không gửi một từ khoá dở dang. Nút "x" gốc của WebKit/Blink được ẩn bằng quy tắc
 * trong tokens.css (trùng nút xoá của DS); vòng focus của khung cũng nằm ở đó (.tubu-search-field).
 */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onChange, onSubmit, onFocus, onClear, label, clearLabel, placeholder },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, []);
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
        className="tubu-search-field"
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
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onKeyDown={(e) => {
            // 229 = phím do bộ gõ xử lý; không để Enter đó kích hoạt gửi form ngầm.
            if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault();
          }}
          style={{
            flex: 1,
            minWidth: 0,
            height: 42,
            border: 'none',
            outline: 'none',
            WebkitAppearance: 'none',
            background: 'transparent',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--type-body-md-size)',
            color: 'var(--color-text-primary)',
          }}
        />
        {value !== '' && (
          <IconButton
            icon={X}
            size="sm"
            label={clearLabel}
            onPress={() => {
              if (onClear) onClear();
              else onChange('');
              inputRef.current?.focus();
            }}
          />
        )}
      </div>
    </form>
  );
});
