import { useEffect, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { isChunkError } from '../../utils/chunk-error';
import { PurchasedRail } from '../reorder/purchased-rail';
import { BestSellerRail } from './best-seller-rail';
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
// query với Trang chủ gắn vào cùng lúc như khi chúng nằm trong gói đầu. Chưa về thì không giữ gì: chỉ các khối CUỐI trang (lưới Gợi ý và hai thẻ chen trong
// lưới: Chẩn đoán tổ ấm, Cộng đồng) nạp lười, mọi thứ chúng có thể đẩy đều nằm phía trên chúng nên không đẩy gì (CLS 0).
function Block({ children }: { children: (m: Below) => ReactNode }) {
  // Đăng ký để vẽ lại khi chunk về; chunk hỏng thì Trang chủ hiện một dải lỗi có "Thử lại" (home.tsx) và các khối vẫn không vẽ gì.
  useSyncExternalStore(subscribe, getState, getState);
  return below ? <>{children(below)}</> : null;
}

// Hai kệ sản phẩm và Giờ vàng (FlashSale ở home.tsx, nạp thẳng từ ../flash-sale) nằm trong gói đầu: thẻ sản phẩm đầu không đợi thêm một request chunk; Giờ vàng
// không hiện muộn hơn dữ liệu của nó (đo: nạp lười làm CLS khách mở lại tăng 0,0087 → 0,0211). Dải ngữ cảnh (Quà khách mới, thẻ thành viên) cũng ở gói đầu vì là hero trong màn đầu.
// Bán chạy nhất ở lại gói đầu: khách mới không có Giờ vàng thì đó là kệ sản phẩm duy nhất, chunk hỏng/chậm không được làm nó biến mất hay bật ra dưới Danh mục.
export const HomePurchasedRail = (p: ComponentProps<typeof PurchasedRail>) => <PurchasedRail {...p} />;
export const HomeBestSellerRail = (p: ComponentProps<typeof BestSellerRail>) => <BestSellerRail {...p} />;
// Ngày của thẻ Cộng đồng: Góc Sống Xanh bật và đủ đánh giá ảnh đã duyệt thì dải ảnh khách đứng chỗ đó, không thì thẻ Cộng đồng như cũ.
export const HomeCommunityPreview = () => <Block>{(m) => <m.GreenCornerStrip fallback={<m.CommunityPreview />} />}</Block>;
export const HomeQuiz = () => <Block>{(m) => <m.HomeQuiz />}</Block>;
export const HomeScrollRestoration = (p: ComponentProps<Below['HomeScrollRestoration']>) => <Block>{(m) => <m.HomeScrollRestoration {...p} />}</Block>;
export const HomeSuggestFeed = (p: ComponentProps<Below['SuggestFeed']>) => <Block>{(m) => <m.SuggestFeed {...p} />}</Block>;
