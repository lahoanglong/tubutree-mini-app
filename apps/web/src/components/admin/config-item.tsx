'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { setConfig, type ConfigRow } from '@/lib/admin-client';

/** Một dòng trong "Tất cả tham số (JSON)" của tab Cấu hình. */
export function ConfigItem({ row, onSaved }: { row: ConfigRow; onSaved: () => void }) {
  const [val, setVal] = useState(JSON.stringify(row.value));
  const [err, setErr] = useState<string | null>(null);
  const dead = row.deprecated === true;
  const save = useMutation({
    mutationFn: () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(val);
      } catch {
        throw new Error('JSON không hợp lệ');
      }
      return setConfig(row.key, parsed);
    },
    onSuccess: () => {
      setErr(null);
      onSaved();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Lỗi'),
  });
  return (
    <div className={`rounded-lg border border-neutral-100 p-3 ${dead ? 'bg-neutral-50 opacity-70' : 'bg-white'}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <span>{row.key}</span>
        {dead && <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600">Không dùng</span>}
      </div>
      {row.description && <div className="text-xs text-neutral-400">{row.description}</div>}
      {dead && <div className="text-xs text-neutral-500">Hệ thống không còn đọc khoá này nên sửa sẽ không có tác dụng.</div>}
      <div className="mt-1 flex gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          disabled={dead}
          aria-label={row.key}
          className="min-h-[44px] min-w-0 flex-1 rounded border border-neutral-200 px-2 py-1 font-mono text-sm disabled:bg-neutral-100 disabled:text-neutral-500"
        />
        {!dead && (
          <button
            onClick={() => {
              setErr(null);
              save.mutate();
            }}
            disabled={save.isPending}
            className="min-h-[44px] shrink-0 rounded bg-green-600 px-3 py-1 text-sm text-white disabled:bg-neutral-300"
          >
            {save.isPending ? 'Đang lưu…' : 'Lưu'}
          </button>
        )}
      </div>
      {err && <div className="text-xs text-red-600">{err}</div>}
    </div>
  );
}
