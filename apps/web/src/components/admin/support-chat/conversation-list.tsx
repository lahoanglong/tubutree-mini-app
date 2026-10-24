'use client';

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { listSupportConversations } from '@/lib/admin-client';
import { formatDateTime } from '@/lib/format-date';
import { BTN_SECONDARY, chipClass, INPUT_CLASS, LoadError, ToneBadge } from '../ui';

export const CONVERSATIONS_KEY = 'admin-support-conversations';

/** Danh sách hội thoại, mới nhất trước; tìm theo SĐT hoặc mã, lọc hội thoại có tin chưa chuyển được. */
export function ConversationList({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [unforwarded, setUnforwarded] = useState(false);
  const listQ = useInfiniteQuery({
    queryKey: [CONVERSATIONS_KEY, q, unforwarded],
    queryFn: ({ pageParam }) => listSupportConversations({ q, unforwarded, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 30_000,
  });
  const items = listQ.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section aria-labelledby="conv-h" className="min-w-0 space-y-3">
      <h2 id="conv-h" className="font-display text-lg font-semibold text-stone-900">Hội thoại</h2>
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft.trim());
        }}
      >
        <input
          name="q"
          aria-label="Tìm theo số điện thoại hoặc mã"
          placeholder="SĐT hoặc mã #K7Q2"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className={INPUT_CLASS}
        />
        <button type="submit" className={BTN_SECONDARY}>Tìm</button>
      </form>
      <div>
        <button type="button" aria-pressed={unforwarded} className={chipClass(unforwarded)} onClick={() => setUnforwarded((v) => !v)}>
          Có tin chưa chuyển được
        </button>
      </div>
      {listQ.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {listQ.isError && <LoadError onRetry={() => void listQ.refetch()} retrying={listQ.isFetching}>Không tải được danh sách hội thoại.</LoadError>}
      {listQ.data && items.length === 0 && <p className="text-sm text-stone-500">Chưa có hội thoại nào.</p>}
      <ul className="space-y-2">
        {items.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              data-conv={c.id}
              aria-pressed={selectedId === c.id}
              onClick={() => onSelect(c.id)}
              className={`min-h-[44px] w-full rounded-card border p-3 text-left ${selectedId === c.id ? 'border-forest-600 bg-forest-50' : 'border-stone-200 bg-stone-0 hover:bg-stone-50'}`}
            >
              <span className="flex flex-wrap items-center justify-between gap-x-2 text-sm">
                <span className="min-w-0 break-words font-medium text-stone-900">
                  #{c.code} · {c.user.fullName ?? 'Khách'}
                </span>
                <span className="text-xs text-stone-500">{formatDateTime(c.lastMessageAt)}</span>
              </span>
              <span className="block text-xs text-stone-600">{c.user.phone ?? 'Chưa có SĐT'}</span>
              <span className="mt-1 block truncate text-xs text-stone-500">
                {c.lastMessage ? `${c.lastMessage.sender === 'CUSTOMER' ? 'Khách' : 'Tubu Tree'}: ${c.lastMessage.body || (c.lastMessage.hasImage ? '[Ảnh]' : '')}` : 'Chưa có tin'}
              </span>
              {(c.needsAttention || c.blocked) && (
                <span className="mt-1 flex flex-wrap gap-1">
                  {c.needsAttention && <ToneBadge tone="warning">Chưa chuyển được</ToneBadge>}
                  {c.blocked && <ToneBadge tone="danger">Đã chặn</ToneBadge>}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {listQ.hasNextPage && (
        <button type="button" className={BTN_SECONDARY} disabled={listQ.isFetchingNextPage} onClick={() => void listQ.fetchNextPage()}>
          {listQ.isFetchingNextPage ? 'Đang tải…' : 'Xem thêm'}
        </button>
      )}
    </section>
  );
}
