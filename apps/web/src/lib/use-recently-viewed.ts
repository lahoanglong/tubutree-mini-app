'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { RECENTLY_VIEWED_EVENT, RECENTLY_VIEWED_KEY, browserStorage, parseRecentlyViewed, type RecentlyViewedItem } from './recently-viewed';

function subscribe(onChange: () => void): () => void {
  window.addEventListener(RECENTLY_VIEWED_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(RECENTLY_VIEWED_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Snapshot là chuỗi thô (so sánh theo giá trị) nên useSyncExternalStore không render lặp vô hạn. Phía server luôn là null: khách thấy dải sau khi hydrate. */
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
