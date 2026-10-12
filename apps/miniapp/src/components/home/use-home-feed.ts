import { useEffect, useRef } from 'react';
import { armHomeFeed, disarmHomeFeed } from '../../services/home-feed';

/**
 * Bật request gộp cho các query của Trang chủ (services/home-feed.ts). Phải arm TRONG render: query của
 * component con khởi chạy ở effect của chúng, chạy trước effect của trang cha.
 */
export function useHomeFeed(): void {
  const armed = useRef(false);
  if (!armed.current) {
    armed.current = true;
    armHomeFeed();
  }
  useEffect(() => {
    armHomeFeed();
    return disarmHomeFeed;
  }, []);
}
