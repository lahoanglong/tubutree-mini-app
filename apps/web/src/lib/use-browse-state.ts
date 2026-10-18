'use client';

import { useCallback, useMemo, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SEARCH_PARAM_KEYS, parseSearchState, serializeSearchState, type SearchState } from './search-state';

export interface UseBrowseState {
  state: SearchState;
  /** Khoá chuẩn của trạng thái (không gồm `focus`, `page` hay tham số lạ) — query key danh sách. */
  urlKey: string;
  /** `?focus=search` từ ô tìm ở trang chủ — dùng MỘT lần rồi `consumeFocus()`. */
  focusSearch: boolean;
  update: (patch: Partial<SearchState>) => void;
  consumeFocus: () => void;
}

/** Tham số dùng một lần hoặc chỉ có nghĩa với trạng thái cũ: `focus`, và `page` (đổi bộ lọc thì về trang 1). */
const TRANSIENT_KEYS = ['focus', 'page'];

/**
 * Trạng thái mới + giữ nguyên tham số lạ (utm, ref, s…) theo đúng thứ tự gốc. Tham số chuẩn được viết lại theo thứ tự cố
 * định, đứng trước — một trạng thái chỉ có một URL.
 */
function withPatch(prev: URLSearchParams, patch: Partial<SearchState>): URLSearchParams {
  const next = serializeSearchState({ ...parseSearchState(prev), ...patch });
  for (const [key, value] of prev) {
    if (!TRANSIENT_KEYS.includes(key) && !SEARCH_PARAM_KEYS.includes(key)) next.append(key, value);
  }
  return next;
}

/**
 * Trạng thái trang danh mục đồng bộ URL. MỌI lần ghi đều `replace` (không chồng mục lịch sử: Back rời trang chứ không tua
 * lại từng bộ lọc) và không cuộn lên đầu.
 *
 * Hai lần ghi trong cùng một nhịp đều tính từ URL mới nhất đã ghi (`latestRef`), không phải từ lần render gần nhất, nếu không
 * lần sau đè mất lần trước. Ref chỉ đồng bộ lại từ URL khi URL render thật sự đổi.
 */
export function useBrowseState(): UseBrowseState {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.toString();
  const state = useMemo(() => parseSearchState(new URLSearchParams(raw)), [raw]);
  const urlKey = useMemo(() => serializeSearchState(state).toString(), [state]);
  const focusSearch = params.get('focus') === 'search';

  const latestRef = useRef(raw);
  const renderedRef = useRef(raw);
  if (renderedRef.current !== raw) {
    renderedRef.current = raw;
    latestRef.current = raw;
  }

  const write = useCallback(
    (build: (prev: URLSearchParams) => URLSearchParams) => {
      const next = build(new URLSearchParams(latestRef.current));
      latestRef.current = next.toString();
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );
  const update = useCallback((patch: Partial<SearchState>) => write((prev) => withPatch(prev, patch)), [write]);
  const consumeFocus = useCallback(
    () =>
      write((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('focus');
        return next;
      }),
    [write],
  );

  return { state, urlKey, focusSearch, update, consumeFocus };
}
