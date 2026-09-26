import type { ReactNode } from 'react';
import type { Tone } from '@/lib/recycling';

/** Màu theo tông — cùng bảng màu badge trạng thái đơn trong web admin (OrderStatusBadge). */
export const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-neutral-100 text-neutral-700',
  info: 'bg-blue-100 text-blue-800',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
};

export function ToneBadge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

const NOTICE_CLASS: Record<'info' | 'warning' | 'danger' | 'success', string> = {
  info: 'border-blue-200 bg-blue-50 text-blue-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-800',
  success: 'border-green-200 bg-green-50 text-green-800',
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
    <div role={role} className={`rounded border px-3 py-2 text-xs leading-relaxed ${NOTICE_CLASS[tone]}`}>
      {children}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-xs">
      <span className="font-medium text-neutral-700">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-0.5 block text-[11px] text-neutral-500">{hint}</span>}
    </label>
  );
}

export const INPUT_CLASS =
  'w-full rounded border border-neutral-200 px-2.5 py-1.5 text-sm focus:border-green-600 focus:outline-none disabled:bg-neutral-50';
