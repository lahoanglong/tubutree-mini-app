import { useEffect, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { HOME_SETTLING_HEIGHTS, purchasedSkeletonHeight, readPurchasedHint, type HomeInterleaveCard } from '@tubutree/app-core/home-layout';
import { PURCHASED_RAIL_LIMIT, usePurchasedItems } from '../../hooks/use-purchased-items';
import { isChunkError } from '../../utils/chunk-error';
import { browserStorage } from '../../utils/recently-viewed';
import { PurchasedRailSkeleton } from '../reorder/purchased-rail-skeleton';
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
// query với Trang chủ gắn vào cùng lúc như khi chúng nằm trong gói đầu. Chưa về thì chỉ giữ `fallback`: các khối CUỐI trang (lưới Gợi ý và hai thẻ chen trong
// lưới: Chẩn đoán tổ ấm, Cộng đồng) không giữ gì vì mọi thứ chúng có thể đẩy đều nằm phía trên chúng (CLS 0); dải Story nằm trên Mua lại và lưới Gợi ý nên giữ đúng chiều cao của nó.
function Block({ children, fallback = null }: { children: (m: Below) => ReactNode; fallback?: ReactNode }) {
  // Đăng ký để vẽ lại khi chunk về; chunk hỏng thì Trang chủ hiện một dải lỗi có "Thử lại" (home.tsx) và các khối vẫn không vẽ gì.
  useSyncExternalStore(subscribe, getState, getState);
  return below ? <>{children(below)}</> : <>{fallback}</>;
}

// Hai kệ sản phẩm và Giờ vàng (FlashSale ở home.tsx, nạp thẳng từ ../flash-sale) nằm trong gói đầu: thẻ sản phẩm đầu không đợi thêm một request chunk; Giờ vàng
// không hiện muộn hơn dữ liệu của nó (đo: nạp lười làm CLS khách mở lại tăng 0,0087 → 0,0211). Dải ngữ cảnh (Quà khách mới, thẻ thành viên) cũng ở gói đầu vì là hero trong màn đầu.
// Bán chạy nhất ở lại gói đầu: khách mới không có Giờ vàng thì đó là kệ sản phẩm duy nhất, chunk hỏng/chậm không được làm nó biến mất hay bật ra dưới Danh mục.
/**
 * Chỗ giữ của kệ Mua lại khi chunk chưa về: cùng khung chờ kệ tự vẽ lúc dữ liệu chưa về (chiều cao theo lần mở trước), nên kệ thật thế chỗ mà trang không nhảy.
 * Dữ liệu đã về mà lần trước không có kệ thì không giữ gì; chunk hỏng thì không giữ gì (Trang chủ đã hiện dải lỗi có "Thử lại"). Cùng khoá query với kệ, không thêm request.
 */
function PurchasedRailWait({ restoring = false }: { restoring?: boolean }) {
  const q = usePurchasedItems(PURCHASED_RAIL_LIMIT);
  const [hint] = useState(() => readPurchasedHint(browserStorage()));
  const { failed } = useSyncExternalStore(subscribe, getState, getState);
  if (failed) return null;
  if (restoring || q.isLoading) return <PurchasedRailSkeleton height={purchasedSkeletonHeight(hint === 'none' ? 'one' : hint)} />;
  return hint === 'none' ? null : <PurchasedRailSkeleton height={purchasedSkeletonHeight(hint)} />;
}

// Kệ Mua lại nằm trong chunk này (không trong gói đầu): chỉ khách cũ đã đăng nhập mới thấy kệ, chunk đã được tải song song từ lúc mã Trang chủ chạy, còn dữ liệu của kệ
// phải chờ phiên khôi phục rồi mới gọi API, nên kệ hầu như không bao giờ phải đợi chunk.
type PurchasedRailProps = ComponentProps<Below['PurchasedRail']>;
export const HomePurchasedRail = (p: PurchasedRailProps) => (
  <Block fallback={<PurchasedRailWait restoring={p.restoring} />}>{(m) => <m.PurchasedRail {...p} />}</Block>
);
export const HomeBestSellerRail = (p: ComponentProps<typeof BestSellerRail>) => <BestSellerRail {...p} />;
/**
 * Thẻ chen của lưới Gợi ý (W47): dải "Khách hàng sống xanh" là dải bằng chứng xã hội duy nhất của Trang chủ, đứng đó mỗi ngày khi Góc Sống Xanh bật và đủ
 * đánh giá ảnh đã duyệt; không đủ thì thẻ của ngày (Chẩn đoán tổ ấm hoặc Cộng đồng, `homeInterleaveCard`).
 */
export const HomeInterleave = ({ fallback }: { fallback: HomeInterleaveCard }) => (
  <Block>{(m) => <m.GreenCornerStrip fallback={fallback === 'quiz' ? <m.HomeQuiz /> : <m.CommunityPreview />} />}</Block>
);
export const HomeScrollRestoration = (p: ComponentProps<Below['HomeScrollRestoration']>) => <Block>{(m) => <m.HomeScrollRestoration {...p} />}</Block>;
export const HomeSuggestFeed = (p: ComponentProps<Below['SuggestFeed']>) => <Block>{(m) => <m.SuggestFeed {...p} />}</Block>;
// Dải Story (dưới màn đầu) cao đúng `HOME_SETTLING_HEIGHTS.stories` cả lúc chờ lẫn lúc có dữ liệu: khung giữ chỗ cùng chiều cao nên Mua lại và lưới Gợi ý không nhảy khi chunk về.
export const HomeStoryReel = () => (
  <Block fallback={<div aria-hidden data-testid="home-stories-wait" style={{ height: HOME_SETTLING_HEIGHTS.stories }} />}>{(m) => <m.HomeStoryReel />}</Block>
);
