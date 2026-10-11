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
// FIELD_CLASS không có chiều rộng để ô nhập đứng cạnh nhau trong hàng flex; INPUT_CLASS là bản chiếm cả hàng.
export const FIELD_CLASS =
  'min-w-0 rounded-control border border-stone-450 bg-stone-0 px-2.5 py-1.5 text-sm text-stone-900 placeholder:text-stone-500 focus:border-forest-600 disabled:bg-stone-100 disabled:text-stone-500';
export const INPUT_CLASS = `w-full ${FIELD_CLASS}`;

// Admin tối ưu cho máy tính (Q-29) nhưng nút/ô nhập phải đủ 44px khi chạm trên điện thoại; từ `sm` trở lên về cỡ gọn.
export const TOUCH_H = 'min-h-[44px] sm:min-h-[36px]';
export const BTN_PRIMARY = `${TOUCH_H} rounded-control bg-forest-600 px-3.5 py-1.5 text-sm font-medium text-stone-0 hover:bg-forest-700 disabled:bg-stone-200 disabled:text-stone-500`;
export const BTN_SECONDARY = `${TOUCH_H} rounded-control border border-stone-450 bg-stone-0 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50`;
export const BTN_DANGER_OUTLINE = `${TOUCH_H} rounded-control border border-danger-fg px-3.5 py-1.5 text-sm font-medium text-danger-fg hover:bg-danger-bg disabled:opacity-50`;
