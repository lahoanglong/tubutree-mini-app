import { useEffect, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { HOME_SETTLING_HEIGHTS as H } from '@tubutree/app-core/home-layout';
import { isChunkError } from '../../utils/chunk-error';
import { Skeleton } from '../ui/skeleton';
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
// query với Trang chủ gắn vào cùng lúc như khi chúng nằm trong gói đầu. Chưa về thì giữ chỗ bằng đúng chiều cao khung chờ chung.
function Block({ height, children }: { height: number; children: (m: Below) => ReactNode }) {
  const { failed } = useSyncExternalStore(subscribe, getState, getState);
  if (below) return <>{children(below)}</>;
  // Chunk hỏng: Trang chủ hiện một dải lỗi có "Thử lại" (home.tsx), các khối không giữ chỗ vĩnh viễn.
  return failed ? null : <Skeleton height={height} radius="var(--radius-card)" />;
}

export const HomeFlashSale = () => (
  <Block height={H.flash}>
    {(m) => (
      <>
        <m.FlashSale />
        <m.UpcomingFlashSales />
      </>
    )}
  </Block>
);
export const HomePurchasedRail = (p: ComponentProps<Below['PurchasedRail']>) => (
  <Block height={H.products}>{(m) => <m.PurchasedRail {...p} />}</Block>
);
export const HomeBestSellerRail = () => <Block height={H.products}>{(m) => <m.BestSellerRail />}</Block>;
export const HomeBrandJourney = () => <Block height={H.products}>{(m) => <m.BrandJourney />}</Block>;
export const HomeCommunityPreview = () => <Block height={H.products}>{(m) => <m.CommunityPreview />}</Block>;
export const HomeNewCustomerGift = () => <Block height={H.flash}>{(m) => <m.NewCustomerGift />}</Block>;
export const HomeSuggestFeed = () => <Block height={H.products}>{(m) => <m.SuggestFeed />}</Block>;
