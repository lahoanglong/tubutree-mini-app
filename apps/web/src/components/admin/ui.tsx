import type { ReactNode } from 'react';
import type { Tone } from '@/lib/recycling';

/** Màu theo tông — cùng bảng màu badge trạng thái đơn trong web admin (OrderStatusBadge). */
export const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-stone-100 text-stone-700',
  info: 'bg-info-bg text-info-fg',
  success: 'bg-success-bg text-success-fg',
  warning: 'bg-warning-bg text-warning-fg',
  danger: 'bg-danger-bg text-danger-fg',
};

export function ToneBadge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

// Màu trạng thái là biến CSS nên không có hậu tố độ trong suốt: viền dùng thẳng màu chữ của tông.
const NOTICE_CLASS: Record<'info' | 'warning' | 'danger' | 'success', string> = {
  info: 'border-info-fg bg-info-bg text-info-fg',
  warning: 'border-warning-fg bg-warning-bg text-warning-fg',
  danger: 'border-danger-fg bg-danger-bg text-danger-fg',
  success: 'border-success-fg bg-success-bg text-success-fg',
};

export function Notice({
  tone = 'info',
  children,
  role,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  children: ReactNode;
  role?: 'alert' | 'status';
}) {
  return (
    <div role={role} className={`break-words rounded-control border px-3 py-2 text-xs leading-relaxed ${NOTICE_CLASS[tone]}`}>
      {children}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-xs">
      <span className="font-medium text-stone-700">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-0.5 block text-[11px] text-stone-500">{hint}</span>}
    </label>
  );
}

// Viền stone-450 đủ 3:1 trên nền trắng/canvas (WCAG 1.4.11), như ô nhập của web khách (lib/guest-ui.ts). Không tắt
// outline: vòng lấy nét chung của globals.css (:focus-visible) là dấu hiệu bàn phím duy nhất.
export const INPUT_CLASS =
  'w-full rounded-control border border-stone-450 bg-stone-0 px-2.5 py-1.5 text-sm text-stone-900 placeholder:text-stone-500 focus:border-forest-600 disabled:bg-stone-100 disabled:text-stone-500';
