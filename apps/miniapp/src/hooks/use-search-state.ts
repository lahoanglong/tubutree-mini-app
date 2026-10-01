import { useCallback, useMemo } from 'react';
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

  const update = useCallback(
    (patch: Partial<SearchState>) => setParams((prev) => withPatch(prev, patch), { replace: true }),
    [setParams],
  );
  const consumeFocus = useCallback(
    () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('focus');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  return { state, urlKey, focusSearch, update, consumeFocus };
}
