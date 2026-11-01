'use client';

// Nguồn: apps/miniapp/src/components/ui/layout-picker.tsx
import { useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { BUILDER_COPY, STYLE_LABEL, type SectionStyle } from '@tubutree/app-core/commerce/storefront-builder';

export interface LayoutPickerProps {
  value: SectionStyle;
  onChange: (style: SectionStyle) => void;
  options: { style: SectionStyle; disabled: boolean }[];
  /** Lời giải thích vì sao có ô khoá; ô khoá trỏ tới đây bằng `aria-describedby`. */
  lockNote?: string | null;
  label?: string;
}

/** Hình minh hoạ 48×32 của từng kiểu: tượng trưng bố cục, không phải ảnh thật. */
function Glyph({ style }: { style: SectionStyle }) {
  const r = { rx: 2, fill: 'currentColor' } as const;
  return (
    <svg width="48" height="32" viewBox="0 0 48 32" aria-hidden="true" focusable="false">
      {style === 'GRID' && (
        <>
          <rect x="4" y="3" width="19" height="12" {...r} />
          <rect x="25" y="3" width="19" height="12" {...r} />
          <rect x="4" y="17" width="19" height="12" {...r} />
          <rect x="25" y="17" width="19" height="12" {...r} />
        </>
      )}
      {style === 'CAROUSEL' && (
        <>
          <rect x="2" y="6" width="13" height="20" {...r} />
          <rect x="18" y="6" width="13" height="20" {...r} />
          <rect x="34" y="6" width="12" height="20" {...r} opacity="0.45" />
        </>
      )}
      {style === 'STACK' && (
        <>
          <rect x="4" y="4" width="40" height="6" {...r} />
          <rect x="4" y="13" width="40" height="6" {...r} />
          <rect x="4" y="22" width="40" height="6" {...r} />
        </>
      )}
      {style === 'COMBO' && (
        <>
          <rect x="4" y="7" width="16" height="18" {...r} />
          <rect x="28" y="7" width="16" height="18" {...r} />
          <path d="M24 12v8M20 16h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
        </>
      )}
    </svg>
  );
}

/**
 * Chọn kiểu hiển thị của một khối: radiogroup 4 ô (Kệ ngang, Lưới, Danh sách, Combo). Mũi tên đổi ô và quay vòng, bỏ qua ô khoá.
 * Ô khoá dùng `aria-disabled` (vẫn nhận focus và đọc được lý do), không `disabled`.
 */
export function LayoutPicker({ value, onChange, options, lockNote, label = BUILDER_COPY.styleLabel }: LayoutPickerProps) {
  const noteId = useId();
  const group = useRef<HTMLDivElement>(null);
  const enabled = options.filter((o) => !o.disabled);
  const tabStop = enabled.some((o) => o.style === value) ? value : enabled[0]?.style;

  const step = (from: SectionStyle, delta: 1 | -1) => {
    if (enabled.length === 0) return;
    const at = enabled.findIndex((o) => o.style === from);
    const next = enabled[(at + delta + enabled.length) % enabled.length]!;
    onChange(next.style);
    group.current?.querySelector<HTMLElement>(`[data-style="${next.style}"]`)?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLElement>, style: SectionStyle) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      step(style, 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      step(style, -1);
    }
  };

  return (
    <div>
      <div ref={group} role="radiogroup" aria-label={label} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
        {options.map((o) => {
          const checked = o.style === value;
          return (
            <button
              key={o.style}
              type="button"
              role="radio"
              data-style={o.style}
              aria-checked={checked}
              aria-disabled={o.disabled ? true : undefined}
              aria-describedby={o.disabled && lockNote ? noteId : undefined}
              tabIndex={o.style === tabStop ? 0 : -1}
              className="tubu-press"
              onClick={() => {
                if (!o.disabled) onChange(o.style);
              }}
              onKeyDown={(e) => onKey(e, o.style)}
              style={{
                minWidth: 0, minHeight: 72, padding: '8px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                border: 'none', borderRadius: 'var(--radius-control)', cursor: o.disabled ? 'default' : 'pointer', font: 'inherit',
                background: checked ? 'var(--color-action-secondary-bg)' : 'var(--color-bg-surface)',
                boxShadow: checked ? 'inset 0 0 0 2px var(--color-action-primary-bg)' : 'inset 0 0 0 1px var(--color-border-subtle)',
                color: checked ? 'var(--color-text-brand)' : 'var(--color-text-tertiary)',
                opacity: o.disabled ? 0.45 : 1,
              }}
            >
              <Glyph style={o.style} />
              <span style={{ fontSize: 'var(--type-caption-size)', lineHeight: 1.2, fontWeight: checked ? 700 : 500, color: 'var(--color-text-primary)', textAlign: 'center', overflowWrap: 'anywhere' }}>
                {STYLE_LABEL[o.style]}
              </span>
            </button>
          );
        })}
      </div>
      {lockNote && (
        <p id={noteId} style={{ margin: '6px 0 0', fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', color: 'var(--color-text-secondary)' }}>
          {lockNote}
        </p>
      )}
    </div>
  );
}
