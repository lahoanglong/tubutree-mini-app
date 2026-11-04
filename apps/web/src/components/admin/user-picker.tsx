'use client';

import { useViewerRole } from '@/lib/auth-context';
import { staffUserSearchProblem } from '@/lib/staff-user-search';
import { searchAdminUsers } from '@/lib/admin-client';
import { userOptionLabel } from '@/lib/admin-pickers';
import { SearchPicker, type PickedItem, type PickerResult } from './search-picker';

const PAGE = 8;

/** Chọn khách/đối tác bằng cách gõ SĐT hoặc tên (BE tìm "chứa", không phân biệt hoa thường) thay cho dán userId. */
export function UserPicker({
  value,
  onChange,
  label,
  debounceMs,
  className,
}: {
  value: PickedItem | null;
  onChange: (v: PickedItem | null) => void;
  label: string;
  debounceMs?: number;
  className?: string;
}) {
  // CSKH (STAFF) chỉ tra được khi từ khoá đủ chặt, như danh sách người dùng: chưa đủ thì hiện gợi ý chứ không gọi API (máy chủ sẽ từ chối).
  const isStaff = useViewerRole() === 'STAFF';
  return (
    <SearchPicker
      value={value}
      onChange={onChange}
      label={label}
      placeholder="Gõ SĐT hoặc tên…"
      queryKey="admin-user-search"
      debounceMs={debounceMs}
      queryProblem={isStaff ? staffUserSearchProblem : undefined}
      className={className}
      search={async (q): Promise<PickerResult> => {
        const res = await searchAdminUsers(q, PAGE);
        return {
          options: res.data.map((u) => ({ id: u.id, label: userOptionLabel(u), detail: u.role })),
          more: Math.max(0, res.meta.total - res.data.length),
        };
      }}
    />
  );
}
