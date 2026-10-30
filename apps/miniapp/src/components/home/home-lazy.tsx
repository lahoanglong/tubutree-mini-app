import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { HOME_SETTLING_HEIGHTS as H } from '@tubutree/app-core/home-layout';
import { Skeleton } from '../ui/skeleton';
import type * as BelowModule from './home-below';

type Below = typeof BelowModule;

let belowPromise: Promise<Below> | null = null;
let below: Below | null = null;
/** Bắt đầu tải chunk các khối dưới màn đầu (gọi nhiều lần vẫn một request). Lỗi mạng: lần sau gọi lại sẽ thử lại. */
export function loadHomeBelow(): Promise<Below> {
  belowPromise ??= import('./home-below').then(
    (m) => {
      below = m;
      return m;
    },
    (e) => {
      belowPromise = null;
      throw e;
    },
  );
  return belowPromise;
}

/** true khi chunk các khối dưới màn đầu đã về. Trang chủ giữ khung chờ chung đến lúc này để khối không hiện rồi đổi hình. */
export function useHomeBelowReady(): boolean {
  const [ready, setReady] = useState(below !== null);
  useEffect(() => {
    if (ready) return;
    let live = true;
    const done = () => live && setReady(true);
    loadHomeBelow().then(done, done);
    return () => {
      live = false;
    };
  }, [ready]);
  return ready;
}

// Không dùng React.lazy: chunk đã về thì khối dựng ngay trong cùng lượt vẽ (không bị treo thêm một nhịp), nên các khối dùng chung
// query với Trang chủ gắn vào cùng lúc như khi chúng nằm trong gói đầu. Chưa về thì giữ chỗ bằng đúng chiều cao khung chờ chung.
function Block({ height, children }: { height: number; children: (m: Below) => ReactNode }) {
  return below ? <>{children(below)}</> : <Skeleton height={height} radius="var(--radius-card)" />;
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
