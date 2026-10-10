'use client';

import { useQuery } from '@tanstack/react-query';
import { countInvoicePending, type InvoiceFilter } from '@/lib/admin-client';

export const INVOICE_FILTERS: { k: InvoiceFilter | ''; label: string }[] = [
  { k: '', label: 'Mọi đơn' },
  { k: 'pending', label: 'VAT chờ xuất' },
  { k: 'issued', label: 'VAT đã xuất' },
  { k: 'all', label: 'Tất cả đơn VAT' },
];

/** Bộ lọc đơn yêu cầu hoá đơn VAT cho tab Đơn hàng (số đơn chờ xuất lấy từ meta.total, không tải danh sách). */
export function InvoiceFilterChips({
  value,
  onChange,
}: {
  value: InvoiceFilter | '';
  onChange: (v: InvoiceFilter | '') => void;
}) {
  const pending = useQuery({ queryKey: ['admin-invoice-pending-count'], queryFn: countInvoicePending });
  return (
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Lọc đơn yêu cầu hoá đơn VAT">
      {INVOICE_FILTERS.map((f) => {
        const active = value === f.k;
        const count = f.k === 'pending' ? pending.data : undefined;
        return (
          <button
            key={f.k || 'none'}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(f.k)}
            className={`min-h-[44px] rounded-full px-3 py-1 text-xs font-medium sm:min-h-[32px] ${
              active
                ? 'bg-green-600 text-white'
                : f.k === 'pending' && (count ?? 0) > 0
                  ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
                  : 'bg-neutral-100 text-neutral-700'
            }`}
          >
            {f.label}
            {count !== undefined && ` (${count})`}
          </button>
        );
      })}
    </div>
  );
}
