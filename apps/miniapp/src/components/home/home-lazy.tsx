import { useEffect, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { isChunkError } from '../../utils/chunk-error';
import { PurchasedRail } from '../reorder/purchased-rail';
import { BestSellerRail } from './best-seller-rail';
import { NewCustomerGiftSkeleton } from './new-customer-gift-skeleton';
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
// query với Trang chủ gắn vào cùng lúc như khi chúng nằm trong gói đầu. Chưa về thì giữ chỗ bằng chính khung chờ của khối (dùng chung
// component, không chép số) hoặc không giữ gì. Chỉ lần mở chưa biết loại khách mới có khung chờ chung và nó KHÔNG đợi chunk, nên khung xám
// thừa ở đây sẽ biến mất khi chunk về và kéo mọi thứ bên dưới lên: chỉ khối nằm trong màn đầu mới được có chỗ giữ.
//
// Hành trình, Cộng đồng, Gợi ý không giữ chỗ vì chúng là ba khối CUỐI trang, mọi thứ chúng có thể đẩy đều nằm phía trên chúng nên không đẩy gì
// (CLS 0). Chúng hiện muộn hơn main một nhịp chunk: Hành trình và Gợi ý trên main có vẽ ngay (thẻ bản đồ; tab và lưới xám) chứ không im lặng
// lúc tải, và khi không có Giờ vàng thì Hành trình của khách cũ nằm gần mép màn 812 (y≈600), nên có thể thấy nó xuất hiện.
function Block({ placeholder = null, children }: { placeholder?: ReactNode; children: (m: Below) => ReactNode }) {
  const { failed } = useSyncExternalStore(subscribe, getState, getState);
  if (below) return <>{children(below)}</>;
  // Chunk hỏng: Trang chủ hiện một dải lỗi có "Thử lại" (home.tsx), các khối không giữ chỗ vĩnh viễn.
  if (failed) return null;
  return <>{placeholder}</>;
}

// Hai kệ sản phẩm và Giờ vàng (HomeFlashSale ở home.tsx, nạp thẳng từ ../flash-sale) nằm trong gói đầu như trước khi tách khối: thẻ sản phẩm đầu
// không đợi thêm một request chunk, và Giờ vàng không hiện muộn hơn dữ liệu của nó (đo: nạp lười làm CLS khách mở lại tăng 0,0087 → 0,0211).
export const HomePurchasedRail = (p: ComponentProps<typeof PurchasedRail>) => <PurchasedRail {...p} />;
export const HomeBestSellerRail = () => <BestSellerRail />;
export const HomeBrandJourney = () => <Block>{(m) => <m.BrandJourney />}</Block>;
export const HomeCommunityPreview = () => <Block>{(m) => <m.CommunityPreview />}</Block>;
export const HomeNewCustomerGift = () => <Block placeholder={<NewCustomerGiftSkeleton />}>{(m) => <m.NewCustomerGift />}</Block>;
export const HomeSuggestFeed = () => <Block>{(m) => <m.SuggestFeed />}</Block>;
