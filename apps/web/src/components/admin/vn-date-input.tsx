'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';

/** "2026-10-03" -> "03/10/2026"; chuỗi rỗng hoặc sai dạng -> "". */
export function isoToVn(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Gõ số liền nhau cũng được: "03102026" -> "03/10/2026". Bỏ ký tự lạ, tối đa 8 số. */
export function maskVnDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** "03/10/2026" -> "2026-10-03"; null nếu thiếu số hoặc ngày không có thật (31/02). */
export function vnToIso(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Ô ngày luôn dd/mm/yyyy, không phụ thuộc ngôn ngữ của trình duyệt (ô `type="date"` gốc hiện mm/dd/yyyy trên Chrome tiếng Anh nên dễ nhập
 * nhầm 03/10 thành 10/03). Giá trị vào/ra vẫn là "yyyy-mm-dd" như ô gốc; chỉ báo lên cha khi gõ đủ một ngày có thật (hoặc xoá hết).
 * Nút lịch mở bộ chọn gốc của trình duyệt cho ai muốn bấm chọn.
 */
export function VnDateInput({
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(isoToVn(value));
  const [touched, setTouched] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  // Cha đổi giá trị (nút "Bỏ lọc ngày", bấm chip nhanh) thì ô chữ theo; chỉ khi khác với những gì đang gõ để không giật con trỏ.
  useEffect(() => {
    setText((cur) => (vnToIso(cur) === value || (!value && cur === '') ? cur : isoToVn(value)));
  }, [value]);
  const iso = vnToIso(text);
  const outOfRange = !!iso && ((!!min && iso < min) || (!!max && iso > max));
  const invalid = touched && text !== '' && (iso === null || outOfRange);

  const edit = (raw: string) => {
    const next = maskVnDate(raw);
    setText(next);
    if (next === '') return onChange('');
    // min/max chỉ để tô lỗi: cha vẫn nhận ngày ngược để tự báo "Ngày bắt đầu phải trước ngày kết thúc".
    const parsed = vnToIso(next);
    if (parsed) onChange(parsed);
  };

  return (
    <span className="relative inline-flex items-center">
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/yyyy"
        maxLength={10}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        value={text}
        disabled={disabled}
        onChange={(e) => edit(e.target.value)}
        onBlur={() => setTouched(true)}
        className={`${className ?? ''} w-36 pr-9 ${invalid ? 'border-danger-fg' : ''}`}
      />
      <button
        type="button"
        aria-label={ariaLabel ? `Chọn ngày: ${ariaLabel}` : 'Chọn ngày từ lịch'}
        disabled={disabled}
        onClick={() => {
          try {
            picker.current?.showPicker?.();
          } catch {
            picker.current?.focus();
          }
        }}
        className="absolute right-1 inline-flex h-8 w-8 items-center justify-center rounded-control text-stone-600 hover:bg-stone-100 disabled:opacity-50"
      >
        <CalendarDays aria-hidden="true" className="h-4 w-4" />
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          setText(isoToVn(e.target.value));
          onChange(e.target.value);
        }}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
      />
      {invalid && (
        <span role="alert" className="sr-only">
          {outOfRange ? 'Ngày nằm ngoài khoảng cho phép.' : 'Nhập ngày dạng dd/mm/yyyy, ví dụ 03/10/2026.'}
        </span>
      )}
    </span>
  );
}

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => `Tháng ${i + 1}`);

/** Ô tháng thành hai ô chọn "Tháng / Năm" (ô `type="month"` gốc hiện "October 2026" trên Chrome tiếng Anh). Giá trị "yyyy-mm". */
export function VnMonthInput({
  value,
  onChange,
  className,
  ariaLabel,
  yearsBack = 5,
}: {
  value: string;
  onChange: (ym: string) => void;
  className?: string;
  ariaLabel?: string;
  yearsBack?: number;
}) {
  const [y, m] = /^(\d{4})-(\d{2})$/.test(value) ? value.split('-') : ['', ''];
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: yearsBack + 2 }, (_, i) => thisYear + 1 - i);
  if (y && !years.includes(Number(y))) years.push(Number(y));
  const emit = (ny: string, nm: string) => onChange(ny && nm ? `${ny}-${nm}` : '');
  return (
    <span role="group" aria-label={ariaLabel} className="inline-flex items-center gap-1">
      <select aria-label={ariaLabel ? `${ariaLabel}: tháng` : 'Tháng'} value={m} onChange={(e) => emit(y || String(thisYear), e.target.value)} className={className}>
        <option value="">Tháng</option>
        {MONTH_NAMES.map((n, i) => (
          <option key={n} value={String(i + 1).padStart(2, '0')}>{n}</option>
        ))}
      </select>
      <select aria-label={ariaLabel ? `${ariaLabel}: năm` : 'Năm'} value={y} onChange={(e) => emit(e.target.value, m || '01')} className={className}>
        <option value="">Năm</option>
        {years.sort((a, b) => b - a).map((yy) => (
          <option key={yy} value={String(yy)}>{yy}</option>
        ))}
      </select>
    </span>
  );
}

/** "yyyy-mm-dd" theo ngày của máy admin (không dùng toISOString: nó cho ngày UTC, lệch một ngày trước 7 giờ sáng giờ VN). */
export function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Lối tắt khoảng ngày cho ô lọc: hôm nay, 7 ngày gần nhất (gồm hôm nay), từ đầu tháng tới hôm nay. */
export function datePresets(now: Date = new Date()): { key: 'today' | '7d' | 'month'; label: string; from: string; to: string }[] {
  const today = localIso(now);
  const week = new Date(now);
  week.setDate(week.getDate() - 6);
  return [
    { key: 'today', label: 'Hôm nay', from: today, to: today },
    { key: '7d', label: '7 ngày', from: localIso(week), to: today },
    { key: 'month', label: 'Tháng này', from: localIso(new Date(now.getFullYear(), now.getMonth(), 1)), to: today },
  ];
}
