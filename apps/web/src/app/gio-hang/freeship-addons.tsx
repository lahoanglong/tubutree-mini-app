'use client';

import { createContext, useContext, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { AovUpsellGoal } from '@tubutree/app-core/cart/aov-upsell';
import { SectionTitle, Skeleton } from '@/components/mini';
import { useFreeshipBoosterCards } from '@/components/cart/freeship-booster/use-freeship-booster-cards';
import { useCardPricing } from '@/lib/use-card-pricing';
import type { FreeshipAddonsViewProps } from './freeship-addons-view';

export interface FreeshipAddonsProps {
  /** Mốc kế tiếp (`aovUpsellGoal`): Miễn phí giao hàng hoặc quà dùng thử 0đ; dòng đầu dải và số còn thiếu gửi cho `GET /upsell/freeship`. */
  goal: AovUpsellGoal;
  /** Các dòng giỏ HIỆN CÓ: món đã trong giỏ không được gợi ý lại. */
  lines: readonly { slug: string; variationId: string }[];
  /** Quà dùng thử 0đ (`aovGiftExclusions`): không gợi ý khách trả tiền cho món quà. */
  exclude?: { slugs: ReadonlySet<string>; variationIds: ReadonlySet<string> };
  /** Dải có hiện không: true đủ món, false không (nguồn đã về hay lỗi, hoặc dải rời màn), null còn chờ nguồn. Giỏ dùng cho `aovGiftLockedRowShown`. */
  onShownChange?: (shown: boolean | null) => void;
  /** Giỏ của khách chưa đăng nhập: "+ Thêm" ghi vào giỏ khách (`addGuestLine`) thay cho giỏ tài khoản. */
  guest?: boolean;
}

// Chunk phần vẽ không tải được (mạng chập): Giỏ vẫn chạy, chỉ thiếu dải, và báo dải không hiện để ô quà khoá nói lại số còn thiếu.
function NoFreeshipAddonsView({ onShownChange }: FreeshipAddonsViewProps) {
  useEffect(() => {
    onShownChange?.(false);
  }, [onShownChange]);
  return null;
}

/**
 * Khung chờ đúng khối của `FreeshipAddonRail` (tiêu đề + 2 thẻ gọn xếp dọc trong `.tubu-addon`): giữ chỗ lúc chunk phần vẽ hay nguồn món còn tải.
 * Dải nằm TRÊN các dòng giỏ, nên hiện muộn mà không giữ chỗ thì đẩy cả danh sách xuống (CLS 0,105 ở 390px khi đã đăng nhập, tubu-w8-01).
 * Nguồn về mà chỉ một món hay không món nào thì khung thu lại: ít gặp hơn nhiều so với dải đủ hai món.
 */
export function FreeshipAddonsPending({ title }: { title?: string | undefined }) {
  return (
    <section aria-hidden data-testid="freeship-addons-pending" className="tubu-addon">
      <div className="tubu-addon-head">
        {title ? (
          <SectionTitle as="p" block>
            {title}
          </SectionTitle>
        ) : (
          <Skeleton width="70%" height="var(--type-title-sm-lh)" />
        )}
      </div>
      <div className="tubu-addon-list">
        {[0, 1].map((i) => (
          <div key={i} className="tubu-addon-card">
            <Skeleton width={48} height={48} radius="var(--radius-media)" />
            <div className="tubu-addon-body">
              <div className="tubu-addon-name">
                <Skeleton width="80%" height={12} />
              </div>
              <Skeleton width={64} height={16} />
            </div>
            <Skeleton width={72} height={44} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Tiêu đề dải cho khung chờ lúc chunk phần vẽ còn tải (`loading` của next/dynamic không nhận props). */
const PendingTitle = createContext<string | undefined>(undefined);
function LoadingFreeshipAddons() {
  return <FreeshipAddonsPending title={useContext(PendingTitle)} />;
}

// Phần vẽ và thêm món là chunk riêng, ngoài JS tải đầu của Giỏ. Hook nguồn món và giá thẻ ở lại đây (dùng chung với Trang chủ và trang sản phẩm): nguồn món
// tải song song với chunk, và tách chúng ra làm webpack chia lại các chunk dùng chung, nặng thêm JS tải đầu của Trang chủ. Lúc chunk còn tải, dải chưa báo
// gì và Giỏ coi `null` là còn chờ.
const FreeshipAddonsView = dynamic(
  () => import('./freeship-addons-view').then((m) => m.FreeshipAddonsView, () => NoFreeshipAddonsView),
  { ssr: false, loading: LoadingFreeshipAddons },
);
// Giỏ khách: chunk riêng, không kéo khoá giỏ tài khoản (`useCartWrite`, lệnh giỏ máy chủ) vào máy khách chưa đăng nhập.
const GuestFreeshipAddonsView = dynamic(
  () => import('./guest-freeship-addons-view').then((m) => m.GuestFreeshipAddonsView, () => NoFreeshipAddonsView),
  { ssr: false, loading: LoadingFreeshipAddons },
);

/**
 * Dải gợi ý mua thêm món nhỏ ở đầu Giỏ (tubu-w7-02): nhắm mốc kế tiếp (Miễn phí giao hàng, rồi quà dùng thử 0đ; dòng đầu theo `aovUpsellGoal().headline`), tối đa 2 món
 * giá không quá 120.000đ (`pickAovAddons`). Nguồn do `useFreeshipBoosterCards` chọn: cờ `commerce.freeship_booster_enabled` bật thì `GET /upsell/freeship`
 * (cửa sổ 45.000đ, giữ thứ tự máy chủ), tắt thì kệ Bán chạy nhất (cùng khoá query với Trang chủ). Lỗi tải thì không vẽ gì: dải chỉ là phần thêm, không được
 * làm giỏ hỏng. Thêm một món là một chạm, cập nhật giỏ theo phản hồi của máy chủ (giá Giờ vàng, combo, mã giảm giá và quà tính lại ở đó nên không cập nhật
 * trước), món mới tự được chọn vì giỏ chỉ nhớ tập món ĐÃ BỎ chọn: thanh Miễn phí giao hàng và ô chọn quà mở ngay khi giỏ mới về, không tải lại trang.
 */
export function FreeshipAddons(props: FreeshipAddonsProps) {
  const { goal, lines, exclude } = props;
  // Món quà cũng gửi vào `exclude`: máy chủ không tốn chỗ trong danh sách cho món dải sẽ bỏ.
  const source = useFreeshipBoosterCards(goal.shortfall, [...lines, ...[...(exclude?.slugs ?? [])].map((slug) => ({ slug }))]);
  const pricing = useCardPricing();
  const View = props.guest ? GuestFreeshipAddonsView : FreeshipAddonsView;
  return (
    <PendingTitle.Provider value={goal.headline}>
      <View {...props} source={source} pricing={pricing} />
    </PendingTitle.Provider>
  );
}
