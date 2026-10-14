'use client';

import { Fragment, useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PICKER_MIN_CHARS } from '@/lib/admin-client';
import { INPUT_CLASS } from './ui';

export interface PickerOption {
  id: string;
  /** Dòng chính trong danh sách kết quả. */
  label: string;
  /** Dòng phụ nhỏ bên dưới. */
  detail?: string;
  /** Tiêu đề nhóm (vd tên sản phẩm cho các biến thể); hiện một lần cho các dòng liền nhau cùng nhóm. */
  group?: string;
  /** Nhãn hiện sau khi chọn; mặc định bằng `label`. */
  pickedLabel?: string;
}
export interface PickedItem {
  id: string;
  label: string;
}
export interface PickerResult {
  options: PickerOption[];
  /** Số kết quả khớp nhưng không hiện (API cắt trang) — nhắc admin gõ cụ thể hơn. */
  more?: number;
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (ms <= 0) {
      setV(value);
      return;
    }
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Ô chọn có tìm kiếm thay cho ô nhập ID thô: gõ → gọi API tìm → bấm một dòng → hiện nhãn đã chọn
 * (bấm "Đổi" để chọn lại). Cha giữ `value` và chỉ nhận `{ id, label }`, nên form cũ vẫn dùng id như trước.
 */
export function SearchPicker({
  value,
  onChange,
  label,
  placeholder,
  queryKey,
  search,
  debounceMs = 250,
  className = 'w-full',
}: {
  value: PickedItem | null;
  onChange: (v: PickedItem | null) => void;
  /** aria-label của ô gõ. */
  label: string;
  placeholder: string;
  queryKey: string;
  search: (q: string) => Promise<PickerResult>;
  debounceMs?: number;
  className?: string;
}) {
  const [text, setText] = useState('');
  const typed = text.trim();
  const debounced = useDebounced(typed, debounceMs);
  const enabled = debounced.length >= PICKER_MIN_CHARS;
  const q = useQuery({ queryKey: [queryKey, debounced], queryFn: () => search(debounced), enabled, staleTime: 30_000 });
  const listId = useId();

  if (value) {
    return (
      <div className={`flex min-h-[44px] items-center justify-between gap-2 rounded-control border border-forest-200 bg-forest-50 px-2.5 py-1 text-sm sm:min-h-[36px] ${className}`}>
        <span className="min-w-0 truncate" title={value.label}>
          {value.label}
        </span>
        <button
          type="button"
          aria-label={`Đổi lựa chọn: ${label}`}
          onClick={() => onChange(null)}
          className="min-h-[44px] shrink-0 px-2 text-xs font-medium text-forest-700 underline sm:min-h-0"
        >
          Đổi
        </button>
      </div>
    );
  }

  const result = enabled ? q.data : undefined;
  const options = result?.options ?? [];
  const waiting = typed.length >= PICKER_MIN_CHARS && (typed !== debounced || q.isFetching);

  return (
    <div className={className}>
      <input
        type="search"
        aria-label={label}
        aria-controls={listId}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={100}
        className={`${INPUT_CLASS} min-h-[44px] sm:min-h-[36px]`}
      />
      <div id={listId}>
        {typed.length < PICKER_MIN_CHARS && <p className="mt-1 text-xs text-stone-500">Gõ ít nhất {PICKER_MIN_CHARS} ký tự để tìm.</p>}
        {waiting && <p className="mt-1 text-xs text-stone-500">Đang tìm…</p>}
        {enabled && !waiting && q.isError && (
          <p role="alert" className="mt-1 text-xs text-danger-fg">
            {(q.error as Error).message || 'Không tìm được, thử lại.'}
          </p>
        )}
        {enabled && !waiting && q.isSuccess && options.length === 0 && (
          <p className="mt-1 text-xs text-stone-500">Không thấy kết quả nào khớp “{debounced}”.</p>
        )}
        {options.length > 0 && !waiting && (
          <ul role="listbox" aria-label={`Kết quả: ${label}`} className="mt-1 max-h-64 overflow-y-auto rounded-control border border-stone-200 bg-stone-0">
            {options.map((o, i) => (
              <Fragment key={o.id}>
                {o.group && o.group !== options[i - 1]?.group && (
                  <li role="presentation" className="bg-stone-50 px-2.5 py-1 text-[11px] font-semibold text-stone-600">
                    {o.group}
                  </li>
                )}
                <li role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      onChange({ id: o.id, label: o.pickedLabel ?? o.label });
                      setText('');
                    }}
                    className="flex min-h-[44px] w-full flex-col items-start justify-center px-2.5 py-1.5 text-left text-sm hover:bg-forest-50 sm:min-h-[36px]"
                  >
                    <span>{o.label}</span>
                    {o.detail && <span className="text-[11px] text-stone-500">{o.detail}</span>}
                  </button>
                </li>
              </Fragment>
            ))}
          </ul>
        )}
        {!waiting && (result?.more ?? 0) > 0 && (
          <p className="mt-1 text-xs text-stone-500">Còn {result!.more} kết quả khác — gõ cụ thể hơn để thu hẹp.</p>
        )}
      </div>
    </div>
  );
}
