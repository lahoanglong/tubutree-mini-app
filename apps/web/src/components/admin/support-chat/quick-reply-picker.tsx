'use client';

import { useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listQuickReplies, type AdminQuickReply } from '@/lib/admin-client';
import { BTN_XS_SECONDARY, INPUT_CLASS, LoadError } from '../ui';

/** Cùng khoá với tab "Mẫu trả lời nhanh": sửa mẫu ở đó thì bộ chọn thấy bản mới, tab đã tải rồi thì mở bộ chọn không gọi lại. */
const QUICK_REPLIES_KEY = ['admin-quick-replies'] as const;

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();

function matches(r: AdminQuickReply, q: string): boolean {
  if (!q) return true;
  return fold([r.title, r.category ?? '', r.content, ...r.keywords].join(' ')).includes(q);
}

/**
 * "Mẫu trả lời": mở danh sách mẫu đang bật (tạo ở tab Mẫu trả lời nhanh), gõ để lọc không dấu, bấm một mẫu là chèn vào ô trả lời rồi đóng.
 * Chỉ tải khi mở lần đầu: phần lớn tin trả lời không cần mẫu.
 */
export function QuickReplyPicker({ onPick }: { onPick: (content: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const listId = useId();
  const q = useQuery({ queryKey: QUICK_REPLIES_KEY, queryFn: listQuickReplies, enabled: open, staleTime: 60_000 });
  const folded = fold(query.trim());
  const active = useMemo(() => (q.data ?? []).filter((r) => r.isActive), [q.data]);
  const items = useMemo(() => active.filter((r) => matches(r, folded)), [active, folded]);

  return (
    <div data-quick-replies className="space-y-2">
      <button
        type="button"
        className={BTN_XS_SECONDARY}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen((v) => !v);
          setQuery('');
        }}
      >
        {open ? 'Đóng mẫu' : 'Mẫu trả lời'}
      </button>
      {open && (
        <div id={listId} className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-2">
          <input
            type="search"
            aria-label="Lọc mẫu trả lời"
            placeholder="Gõ để lọc: giao hàng, đổi trả…"
            maxLength={60}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={INPUT_CLASS}
          />
          {q.isPending && <p className="text-xs text-stone-600">Đang tải mẫu…</p>}
          {q.isError && (
            <LoadError onRetry={() => q.refetch()} retrying={q.isFetching}>
              Không tải được mẫu trả lời.
            </LoadError>
          )}
          {q.data && items.length === 0 && (
            <p className="text-xs text-stone-600">{active.length > 0 ? 'Không có mẫu khớp.' : 'Chưa có mẫu nào đang bật. Tạo ở tab Mẫu trả lời nhanh.'}</p>
          )}
          {items.length > 0 && (
            <ul className="max-h-60 divide-y divide-stone-100 overflow-y-auto" aria-label="Mẫu trả lời đang bật">
              {items.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    data-quick-reply={r.id}
                    className="block min-h-[44px] w-full px-2 py-1.5 text-left hover:bg-stone-50"
                    onClick={() => {
                      onPick(r.content);
                      setOpen(false);
                      setQuery('');
                    }}
                  >
                    <span className="block text-xs font-semibold text-stone-900">
                      {r.title}
                      {r.category && <span className="font-normal text-stone-600"> · {r.category}</span>}
                    </span>
                    <span className="block truncate text-xs text-stone-600">{r.content}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
