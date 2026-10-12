import { useMemo, useSyncExternalStore } from 'react';
import {
  RECENTLY_VIEWED_EVENT, RECENTLY_VIEWED_KEY, browserStorage, parseRecentlyViewed, type RecentlyViewedItem,
} from '../utils/recently-viewed';

function subscribe(onChange: () => void): () => void {
  window.addEventListener(RECENTLY_VIEWED_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(RECENTLY_VIEWED_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Snapshot là CHUỖI thô (so sánh bằng giá trị) → useSyncExternalStore không render lặp vô hạn. */
function snapshot(): string | null {
  try {
    return browserStorage()?.getItem(RECENTLY_VIEWED_KEY) ?? null;
  } catch {
    return null;
  }
}

export function useRecentlyViewed(): RecentlyViewedItem[] {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  return useMemo(() => parseRecentlyViewed(raw), [raw]);
}
