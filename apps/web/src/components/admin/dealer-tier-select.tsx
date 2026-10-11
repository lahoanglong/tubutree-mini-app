'use client';

import { useQuery } from '@tanstack/react-query';
import { listDealerTiers } from '@/lib/admin-client';
import { tierOptionLabel } from '@/lib/admin-pickers';
import { INPUT_CLASS } from './ui';

/** Chọn bậc đại lý từ danh sách thật thay cho gõ Tier ID (gõ sai id → BE từ chối mà admin không biết id nào hợp lệ). */
export function DealerTierSelect({
  value,
  onChange,
  label = 'Bậc đại lý',
  className = 'w-full',
}: {
  value: string;
  onChange: (tierId: string) => void;
  label?: string;
  className?: string;
}) {
  const q = useQuery({ queryKey: ['admin-dealer-tiers'], queryFn: listDealerTiers, staleTime: 60_000 });

  if (q.isError) {
    return (
      <p role="alert" className="text-xs text-danger-fg">
        Không tải được danh sách bậc đại lý.{' '}
        <button type="button" onClick={() => void q.refetch()} className="min-h-[44px] font-medium underline sm:min-h-0">
          Thử lại
        </button>
      </p>
    );
  }
  const tiers = q.data ?? [];
  if (q.isSuccess && tiers.length === 0) {
    return <p className="text-xs text-warning-fg">Chưa có bậc đại lý nào — cần tạo bậc đại lý trước khi duyệt hoặc cấp vai trò đại lý.</p>;
  }
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={q.isLoading}
      className={`${INPUT_CLASS} min-h-[44px] sm:min-h-[36px] ${className}`}
    >
      <option value="">{q.isLoading ? 'Đang tải bậc đại lý…' : 'Chọn bậc đại lý (bắt buộc)'}</option>
      {tiers.map((t) => (
        <option key={t.id} value={t.id}>
          {tierOptionLabel(t)}
        </option>
      ))}
    </select>
  );
}
