import { useEffect, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { isChunkError } from '../../utils/chunk-error';
import { PurchasedRail } from '../reorder/purchased-rail';
import { BestSellerRail } from './best-seller-rail';
import { NewCustomerGift } from './new-customer-gift';
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
  /** Chunk đã về (khối dựng được) HOẶC đã hỏng. */
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

/** Trạng thái chunk các khối dưới màn đầu (chunk hỏng thì Trang chủ hiện dải lỗi có "Thử lại"). */
export function useHomeBelow(): BelowState {
  const s = useSyncExternalStore(subscribe, getState, getState);
  useEffect(() => {
    if (!s.ready) loadHomeBelow().catch(() => undefined);
  }, [s.ready]);
  return s;
}

// Không dùng React.lazy: chunk đã về thì khối dựng ngay trong cùng lượt vẽ (không bị treo thêm một nhịp), nên các khối dùng chung
// query với Trang chủ gắn vào cùng lúc như khi chúng nằm trong gói đầu. Chưa về thì không giữ gì: chỉ ba khối CUỐI trang (Hành trình, Cộng đồng,
// Gợi ý) nạp lười, mọi thứ chúng có thể đẩy đều nằm phía trên chúng nên không đẩy gì (CLS 0). Chúng hiện muộn hơn main một nhịp chunk: Hành trình
// và Gợi ý trên main có vẽ ngay (thẻ bản đồ; tab và lưới xám) chứ không im lặng lúc tải, và khi không có Giờ vàng thì Hành trình của khách cũ
// nằm gần mép màn 812 (y≈600), nên có thể thấy nó xuất hiện.
function Block({ children }: { children: (m: Below) => ReactNode }) {
  // Đăng ký để vẽ lại khi chunk về; chunk hỏng thì Trang chủ hiện một dải lỗi có "Thử lại" (home.tsx) và các khối vẫn không vẽ gì.
  useSyncExternalStore(subscribe, getState, getState);
  return below ? <>{children(below)}</> : null;
}

// Hai kệ sản phẩm, Giờ vàng (HomeFlashSale ở home.tsx, nạp thẳng từ ../flash-sale) và dải Quà khách mới nằm trong gói đầu như trước khi tách khối: thẻ sản phẩm
// đầu không đợi thêm một request chunk; Giờ vàng không hiện muộn hơn dữ liệu của nó (đo: nạp lười làm CLS khách mở lại tăng 0,0087 → 0,0211); dải quà là hero
// trong màn đầu nên hai query của nó chạy ngay lượt vẽ đầu và nó tự thu về null (khách đã có đơn) mà không đợi chunk.
export const HomePurchasedRail = (p: ComponentProps<typeof PurchasedRail>) => <PurchasedRail {...p} />;
export const HomeBestSellerRail = () => <BestSellerRail />;
export const HomeBrandJourney = () => <Block>{(m) => <m.BrandJourney />}</Block>;
export const HomeCommunityPreview = () => <Block>{(m) => <m.CommunityPreview />}</Block>;
export const HomeNewCustomerGift = () => <NewCustomerGift />;
export const HomeSuggestFeed = () => <Block>{(m) => <m.SuggestFeed />}</Block>;
