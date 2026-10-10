'use client';

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
  return (
    <SearchPicker
      value={value}
      onChange={onChange}
      label={label}
      placeholder="Gõ SĐT hoặc tên…"
      queryKey="admin-user-search"
      debounceMs={debounceMs}
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
