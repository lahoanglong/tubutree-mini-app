import { useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SEARCH_PARAM_KEYS, parseSearchState, serializeSearchState, type SearchState } from '../utils/search-state';

export interface UseSearchState {
  state: SearchState;
  /** Khoá chuẩn của trạng thái (không gồm `focus` hay tham số lạ) — query key danh sách + khoá vị trí cuộn. */
  urlKey: string;
  /** `?focus=search` từ ô tìm ở Trang chủ — dùng MỘT lần rồi `consumeFocus()`. */
  focusSearch: boolean;
  update: (patch: Partial<SearchState>) => void;
  consumeFocus: () => void;
}

/**
 * Trạng thái mới + giữ nguyên tham số lạ (utm, ref…) theo đúng thứ tự gốc, cùng quy tắc với
 * `consumeFocus` (cả hai chỉ bỏ `focus`). Tham số chuẩn được viết lại theo thứ tự cố định, đứng trước.
 */
function withPatch(prev: URLSearchParams, patch: Partial<SearchState>): URLSearchParams {
  const next = serializeSearchState({ ...parseSearchState(prev), ...patch });
  for (const [key, value] of prev) {
    if (key !== 'focus' && !SEARCH_PARAM_KEYS.includes(key)) next.append(key, value);
  }
  return next;
}

/**
 * Trạng thái Browse đồng bộ URL (spec 5b.2). MỌI lần ghi đều `replace: true` — đổi bộ lọc không
 * chồng thêm mục lịch sử, nút Back rời Browse chứ không tua lại từng bộ lọc.
 */
export function useSearchState(): UseSearchState {
  const [params, setParams] = useSearchParams();
  const raw = params.toString();
  const state = useMemo(() => parseSearchState(new URLSearchParams(raw)), [raw]);
  const urlKey = useMemo(() => serializeSearchState(state).toString(), [state]);
  const focusSearch = params.get('focus') === 'search';

  // `setSearchParams(fn)` của react-router gọi `fn` với searchParams của LẦN RENDER GẦN NHẤT (không xếp
  // hàng như setState) → hai lần ghi trong cùng một nhịp cùng xuất phát từ nền cũ, lần sau đè lần trước.
  // Nên mọi lần ghi tính từ `latestRef` (URL mới nhất đã ghi) rồi ghi lại vào ref TRƯỚC khi điều hướng.
  // Ref chỉ được đồng bộ lại từ URL khi URL render thật sự đổi (điều hướng ngoài, hoặc lô ghi vừa
  // commit): một lô ghi cùng nhịp commit đúng một lần với URL cuối nên ref không bao giờ lùi.
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
      setParams(next, { replace: true });
    },
    [setParams],
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
