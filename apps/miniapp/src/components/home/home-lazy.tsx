import { useEffect, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { FLASH_SKELETON_HEIGHT, HOME_HERO_HEIGHT, HOME_SETTLING_HEIGHTS as H, readFlashHint } from '@tubutree/app-core/home-layout';
import { isChunkError } from '../../utils/chunk-error';
import { browserStorage } from '../../utils/recently-viewed';
import { Skeleton } from '../ui/skeleton';
import { PurchasedRailSkeleton } from './purchased-rail-skeleton';
import type * as BelowModule from './home-below';

type Below = typeof BelowModule;

let belowPromise: Promise<Below> | null = null;
let below: Below | null = null;
let state: BelowState = { ready: false, failed: false, error: undefined };
const listeners = new Set<() => void>();
function setState(next: BelowState) {
  state = next;
  listeners.forEach((l) => l());
}

export interface BelowState {
  /** Chunk đã về (khối dựng được) HOẶC đã hỏng: Trang chủ thôi giữ khung chờ chung. */
  ready: boolean;
  failed: boolean;
  error: unknown;
}

/** Bắt đầu tải chunk các khối dưới màn đầu (gọi nhiều lần vẫn một request). Lỗi mạng: lần sau gọi lại sẽ thử lại. */
export function loadHomeBelow(): Promise<Below> {
  belowPromise ??= import('./home-below').then(
    (m) => {
      below = m;
      setState({ ready: true, failed: false, error: undefined });
      return m;
    },
    (e) => {
      belowPromise = null;
      setState({ ready: true, failed: true, error: e });
      throw e;
    },
  );
  return belowPromise;
}

/** Thử tải lại chunk sau lỗi (trình duyệt có thể nhớ import hỏng: lỗi kiểu chunk thì tải lại cả app, như RouteBoundary). */
export function retryHomeBelow(): void {
  if (state.failed && isChunkError(state.error)) {
    window.location.reload();
    return;
  }
  setState({ ready: false, failed: false, error: undefined });
  loadHomeBelow().catch(() => undefined);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const getState = () => state;

/** Trạng thái chunk các khối dưới màn đầu. Trang chủ giữ khung chờ chung tới khi `ready` để khối không hiện rồi đổi hình. */
export function useHomeBelow(): BelowState {
  const s = useSyncExternalStore(subscribe, getState, getState);
  useEffect(() => {
    if (!s.ready) loadHomeBelow().catch(() => undefined);
  }, [s.ready]);
  return s;
}

// Không dùng React.lazy: chunk đã về thì khối dựng ngay trong cùng lượt vẽ (không bị treo thêm một nhịp), nên các khối dùng chung
// query với Trang chủ gắn vào cùng lúc như khi chúng nằm trong gói đầu. Chưa về thì giữ chỗ đúng bằng hình lúc đang tải của chính khối đó
// (hoặc không giữ chỗ nếu khối im lặng lúc tải): chỉ lần mở chưa biết loại khách mới có khung chờ chung, máy đã nhớ loại khách thì không,
// nên khung xám thừa ở đây sẽ biến mất khi chunk về và kéo mọi thứ bên dưới lên.
interface Slot {
  /** Chiều cao ô xám; 0 = khối không vẽ gì lúc tải nên không giữ chỗ. */
  height: number;
  /** Lề trên và đệm dưới quanh ô xám, đúng như khung chờ của khối thật (lề trên là lề, không phải đệm, để cùng một phần tử thay chỗ nhau mà không bị tính là dịch chuyển). */
  top?: number;
  bottom?: number;
}
const SLOT_GIFT: Slot = { height: HOME_HERO_HEIGHT, bottom: 12 };
const SLOT_FLASH: Slot = { height: H.flash, top: FLASH_SKELETON_HEIGHT - H.flash };
const SLOT_NONE: Slot = { height: 0 };

function Block({ slot, placeholder, children }: { slot: Slot; placeholder?: ReactNode; children: (m: Below) => ReactNode }) {
  const { failed } = useSyncExternalStore(subscribe, getState, getState);
  if (below) return <>{children(below)}</>;
  // Chunk hỏng: Trang chủ hiện một dải lỗi có "Thử lại" (home.tsx), các khối không giữ chỗ vĩnh viễn.
  if (failed) return null;
  if (placeholder) return <>{placeholder}</>;
  if (slot.height === 0) return null;
  const top = slot.top ?? 0;
  const bottom = slot.bottom ?? 0;
  return (
    <div
      data-testid="home-below-placeholder"
      data-height={top + slot.height + bottom}
      aria-hidden="true"
      style={{ marginTop: top, padding: `0 16px ${bottom}px` }}
    >
      <Skeleton height={slot.height} radius="var(--radius-card)" />
    </div>
  );
}

export const HomeFlashSale = () => {
  // Lần mở trước có Giờ vàng thì giữ chỗ (như FlashSale lúc tải); chưa nhớ thì chờ im lặng.
  const [hadFlash] = useState(() => readFlashHint(browserStorage()));
  return (
    <Block slot={hadFlash ? SLOT_FLASH : SLOT_NONE}>
      {(m) => (
        <>
          <m.FlashSale />
          <m.UpcomingFlashSales />
        </>
      )}
    </Block>
  );
};
export const HomePurchasedRail = (p: ComponentProps<Below['PurchasedRail']>) => (
  <Block slot={SLOT_NONE} placeholder={<PurchasedRailSkeleton />}>{(m) => <m.PurchasedRail {...p} />}</Block>
);
export const HomeBestSellerRail = () => <Block slot={{ height: H.products }}>{(m) => <m.BestSellerRail />}</Block>;
export const HomeBrandJourney = () => <Block slot={SLOT_NONE}>{(m) => <m.BrandJourney />}</Block>;
export const HomeCommunityPreview = () => <Block slot={SLOT_NONE}>{(m) => <m.CommunityPreview />}</Block>;
export const HomeNewCustomerGift = () => <Block slot={SLOT_GIFT}>{(m) => <m.NewCustomerGift />}</Block>;
export const HomeSuggestFeed = () => <Block slot={SLOT_NONE}>{(m) => <m.SuggestFeed />}</Block>;
